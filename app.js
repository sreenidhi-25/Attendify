// ================= WASM INIT =================
let ModuleInstance = null;

// The Popup Function injected by user
window.showPopup = function(message, type = "info") {
    const popup = document.getElementById("popup");
    if (!popup) return;
    
    popup.innerText = message;
    if (type === "success") popup.style.background = "#10b981"; // green
    else if (type === "error") popup.style.background = "#ef4444"; // red
    else popup.style.background = "#333333";

    popup.style.display = "block";
    setTimeout(() => {
        popup.style.display = "none";
    }, 3000);
}

Module().then((mod) => {
  ModuleInstance = mod;
  console.log("WASM Loaded ✅");

  // Load initial data from localStorage
  const savedData = localStorage.getItem("attendanceData");
  if (savedData) {
    try {
        ModuleInstance.ccall("loadData", null, ["string"], [savedData]);
        console.log("Loaded data from localStorage.");
    } catch(e) {
        console.error("Failed to load initial data", e);
    }
  }

  if (currentSlot) {
      fetchStudents();
  }
});

function persistData() {
    if (!ModuleInstance) return;
    try {
        const jsonStr = ModuleInstance.ccall("saveData", "string", [], []);
        localStorage.setItem("attendanceData", jsonStr);
    } catch(e) {
        console.error("Failed to persist data", e);
    }
}

// ================= STATE =================
let currentSlot = null;
let studentData = [];
let dashboardFilter = "all";

// ================= VIEWS =================
const views = {
  slot: document.getElementById("slot-selection-view"),
  app: document.getElementById("app-container"),
  dashboard: document.getElementById("dashboard-view"),
  students: document.getElementById("students-view"),
  mark: document.getElementById("mark-view"),
};

// ================= SLOT =================
window.selectSlot = function(slotName) {
  currentSlot = slotName;
  document.getElementById("slot-dropdown").value = slotName;
  document.getElementById("add-modal-slot-desc").innerText =
    `Adding to Class ${slotName}`;

  views.slot.classList.add("hidden");
  views.app.classList.remove("hidden");

  switchView("dashboard");
}

window.changeSlotFromDropdown = function(slotName) {
  currentSlot = slotName;
  document.getElementById("add-modal-slot-desc").innerText =
    `Adding to Class ${slotName}`;
  fetchStudents();
}

// ================= NAV =================
const navLinks = {
  dashboard: document.getElementById("nav-dashboard"),
  students: document.getElementById("nav-students"),
  mark: document.getElementById("nav-mark"),
};

window.switchView = function(viewName) {
  views.dashboard.classList.add("hidden");
  views.students.classList.add("hidden");
  views.mark.classList.add("hidden");

  Object.values(navLinks).forEach((n) => n.classList.remove("active"));

  views[viewName].classList.remove("hidden");
  navLinks[viewName].classList.add("active");

  const titles = {
    dashboard: "Dashboard",
    students: "Students",
    mark: "Mark Attendance",
  };
  document.getElementById("top-nav-title").innerText = titles[viewName];

  if (viewName === "dashboard" || viewName === "students") {
    fetchStudents();
  }
  if (viewName === "mark") {
    setupAttendanceForm();
  }
}

navLinks.dashboard.addEventListener("click", () => switchView("dashboard"));
navLinks.students.addEventListener("click", () => switchView("students"));
navLinks.mark.addEventListener("click", () => switchView("mark"));

// ================= WASM API =================
function fetchStudents() {
  if (!currentSlot || !ModuleInstance) return;

  try {
      const result = ModuleInstance.ccall(
        "getStudents",
        "string",
        ["string"],
        [currentSlot]
      );
    
      const data = JSON.parse(result);
      studentData = data.students || [];
    
      updateDashboard(data.classAverage);
      updateStudentsList();
      
      // If we are currently on the mark view, refresh it automatically!
      if (!views.mark.classList.contains("hidden")) {
          setupAttendanceForm();
      }
  } catch (e) {
      console.error("fetchStudents failed", e);
  }
}

function addStudent(regNo, name) {
  if (!ModuleInstance) return;

  const success = ModuleInstance.ccall(
    "addStudent",
    "number",
    ["string", "string", "string"],
    [regNo, name, currentSlot]
  );

  if (success === 1) {
    persistData();
    closeModal("add-modal");
    document.getElementById("new-regno").value = "";
    document.getElementById("new-name").value = "";
    fetchStudents();
    showPopup("Student added securely!", "success");
  } else {
    showPopup("Failed. Reg No might already exist.", "error");
  }
}

window.viewStudent = function(regNo) {
  if (!ModuleInstance) return;

  const result = ModuleInstance.ccall(
    "getStudents",
    "string",
    ["string"],
    [currentSlot],
  );

  const data = JSON.parse(result);
  const student = data.students.find((s) => s.regNo === regNo);
  if (!student) return;

  let html = `
    <p><strong>Name:</strong> ${student.name}</p>
    <p><strong>Reg No:</strong> ${student.regNo}</p>
    <p><strong>Attendance:</strong> ${getBadgeHtml(student.percentage)} (${student.attended}/${student.totalClasses})</p>
  `;

  document.getElementById("detail-info").innerHTML = html;

  let heatHtml = Object.entries(student.records || {})
    .map(
      ([date, status]) =>
        `<div class="heat-box heat-${status}" title="${date}: ${status}">${status}</div>`,
    )
    .join("");

  document.getElementById("detail-calendar").innerHTML =
    heatHtml || "No records provided yet.";

  openModal("detail-modal");
}

// ================= UI Utilities =================
function getBadgeHtml(percent) {
  if (percent >= 80)
    return `<span class="badge badge-success">${percent.toFixed(1)}%</span>`;
  if (percent >= 65)
    return `<span class="badge badge-warning">${percent.toFixed(1)}%</span>`;
  return `<span class="badge badge-critical">${percent.toFixed(1)}%</span>`;
}

// ================= DASHBOARD =================
document.querySelectorAll(".pill-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    // Remove formatting classes from all buttons
    document
      .querySelectorAll(".pill-btn")
      .forEach((b) =>
        b.classList.remove("active", "danger", "warning", "success"),
      );

    const filter = e.currentTarget.dataset.filter;
    e.currentTarget.classList.add("active");

    if (filter === "below75") e.currentTarget.classList.add("danger");
    if (filter === "atRisk") e.currentTarget.classList.add("warning");
    if (filter === "top") e.currentTarget.classList.add("success");

    dashboardFilter = filter;
    updateDashboardCardsInfo();
  });
});

function updateDashboard(classAverage) {
  document.getElementById("class-average").innerText =
    `${classAverage.toFixed(1)}%`;
  document.getElementById("total-students").innerText = studentData.length;

  const shortages = studentData.filter(
    (s) => s.percentage < 75 && s.totalClasses > 0,
  );
  document.getElementById("shortage-count").innerText = shortages.length;

  updateDashboardCardsInfo();
}

function updateDashboardCardsInfo() {
  let filteredList = studentData;

  if (dashboardFilter === "below75") {
    filteredList = studentData.filter(
      (s) => s.percentage < 75 && s.totalClasses > 0,
    );
  } else if (dashboardFilter === "atRisk") {
    filteredList = studentData.filter(
      (s) => s.percentage >= 75 && s.percentage < 80 && s.totalClasses > 0,
    );
  } else if (dashboardFilter === "top") {
    filteredList = studentData.filter(
      (s) => s.percentage >= 90 && s.totalClasses > 0,
    );
  }

  const listHtml = filteredList
    .map(
      (s) => `
        <div class="list-row">
            <div>${s.regNo}</div>
            <div>${s.name}</div>
            <div>${getBadgeHtml(s.percentage)}</div>
            <div><button class="btn btn-secondary btn-small" onclick="window.viewStudent('${s.regNo}')">View</button></div>
        </div>
      `,
    )
    .join("");

  document.getElementById("dash-student-list").innerHTML =
    `
        <div class="list-row header">
            <span>Reg No</span><span>Name</span><span>Percentage</span><span>Action</span>
        </div>
    ` + listHtml;
}

function updateStudentsList() {
  const listHtml = studentData
    .map(
      (s) => `
        <div class="list-row">
            <div>${s.regNo}</div>
            <div>${s.name}</div>
            <div>${getBadgeHtml(s.percentage)}</div>
            <div><button class="btn btn-secondary btn-small" onclick="window.viewStudent('${s.regNo}')">Details</button></div>
        </div>
      `,
    )
    .join("");

  document.getElementById("all-students-list").innerHTML =
    `
        <div class="list-row header">
            <span>Reg No</span><span>Name</span><span>Percentage</span><span>Action</span>
        </div>
    ` + listHtml;
}

// ================= MODALS =================
window.openModal = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}
window.closeModal = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
}

document.getElementById("open-add-modal").addEventListener("click", () => openModal("add-modal"));
document.getElementById("close-modal").addEventListener("click", () => closeModal("add-modal"));
document.getElementById("close-detail-modal").addEventListener("click", () => closeModal("detail-modal"));

document.getElementById("save-student").addEventListener("click", () => {
  const r = document.getElementById("new-regno").value.trim();
  const n = document.getElementById("new-name").value.trim();
  if (r && n) {
      addStudent(r, n);
  } else {
      showPopup("Please fill in both Registration Number and Name.", "error");
  }
});

// ================= ATTENDANCE =================

// Declared globally so `switchView` finds it synchronously and without hoisting faults
window.setupAttendanceForm = function() {
    if (!document.getElementById("attendance-date").value) {
        document.getElementById("attendance-date").valueAsDate = new Date();
    }
    
    // Default attendance form render empty
    if (!studentData || studentData.length === 0) {
        document.getElementById("attendance-form-list").innerHTML = `
            <div class="list-row header">
                <span>Reg No</span><span>Name</span><span>Status (P/A)</span>
            </div>
            <div class="list-row" style="grid-column: 1 / -1; justify-content: center; font-style: italic; color: #888;">
                No students enrolled in this class. Add some via the Students tab first!
            </div>
        `;
        return;
    }

    const listHtml = studentData.map(s => `
        <div class="list-row">
            <div>${s.regNo}</div>
            <div>${s.name}</div>
            <div class="status-toggle" data-regno="${s.regNo}" style="display: flex; gap: 5px;">
                <button class="btn btn-small status-btn" data-status="P" style="border: 1px solid var(--border);" onclick="window.toggleStatus(this, 'P')">P</button>
                <button class="btn btn-small status-btn" data-status="A" style="border: 1px solid var(--border);" onclick="window.toggleStatus(this, 'A')">A</button>
            </div>
        </div>
    `).join("");

    document.getElementById("attendance-form-list").innerHTML = `
        <div class="list-row header">
            <span>Reg No</span><span>Name</span><span>Status (P/A)</span>
        </div>
    ` + listHtml;
}

window.toggleStatus = function(btn, status) {
    const parent = btn.parentElement;
    parent.querySelectorAll('.status-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-color, black)'; // Fallback in case var not fully set
    });
    
    btn.classList.add('active');
    if (status === 'P') {
        btn.style.background = '#10b981'; // explicit success color
        btn.style.border = '1px solid #10b981';
        btn.style.color = 'white';
    } else {
        btn.style.background = '#ef4444'; // explicit fail color
        btn.style.border = '1px solid #ef4444';
        btn.style.color = 'white';
    }
}

document.getElementById("save-attendance-btn").addEventListener("click", () => {
  const date = document.getElementById("attendance-date").value;
  if (!date) {
      showPopup("Please select a date.", "error");
      return;
  }

  const records = {};
  let anySelected = false;
  
  document.querySelectorAll(".status-toggle").forEach((el) => {
    const regNo = el.dataset.regno;
    const activeBtn = el.querySelector(".active");
    if (activeBtn) {
        records[regNo] = activeBtn.dataset.status;
        anySelected = true;
    }
  });

  if (!anySelected) {
      showPopup("Please mark attendance for at least one student before saving.", "error");
      return;
  }

  const success = ModuleInstance.ccall( // Using ModuleInstance
    "markAttendance",
    "number",
    ["string", "string"],
    [date, JSON.stringify(records)],
  );

  if (success === 1) { // Exact check 1
      persistData();
      fetchStudents(); // Forces UI refresh
      showPopup("Attendance saved successfully!", "success");
  } else {
      showPopup("Error saving attendance (Date might be invalid).", "error");
  }
});
