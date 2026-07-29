// ===================== FIREBASE CONFIG =====================
// Same foodqc project, pointed at the separate privy-check database instance
const firebaseConfig = {
  apiKey: "AIzaSyAQrAWn29o64MJzrpZ8-7yCDHJQNRVHzpU",
  authDomain: "faire-food-qc.firebaseapp.com",
  databaseURL: "https://privy-check.firebaseio.com",
  projectId: "faire-food-qc",
  storageBucket: "faire-food-qc.firebasestorage.app",
  messagingSenderId: "872552099867",
  appId: "1:872552099867:web:29a72c41c4df0c1cbcc8be"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
const storage = firebase.storage();
const functions = firebase.functions();

// Sign in anonymously as soon as the app loads, so database rules (auth != null)
// are satisfied before any PIN lookup happens. Same pattern as Punch List.
const authReady = auth.signInAnonymously().catch((err) => {
  console.error("Anonymous auth failed:", err);
});

// ===================== CONSTANTS =====================
const SITES = { parf: "PARF", srf: "SRF", krf: "KRF", garf: "GARF" };

const ROLES = {
  superadmin: { label: "Superadmin", scope: "all" },
  superuser: { label: "Super User", scope: "site" },
  user: { label: "User", scope: "site" },
  maintenance: { label: "Maintenance", scope: "site" }
};

// Default suggested out-of-order reasons (editable by Superadmin in Admin Panel later)
const DEFAULT_OOO_REASONS = [
  "Clogged / won't flush",
  "No running water",
  "No power / lights out",
  "Door lock broken",
  "Overflow / sewage backup",
  "Structural damage",
  "Vandalism",
  "Out of supplies (TP/soap/towels)",
  "Severe odor / sewage smell",
  "Locked / inaccessible",
  "Ventilation/HVAC issue",
  "Other (describe below)"
];

// ===================== STATE =====================
let currentPin = "";
let currentUser = null; // { uid, firstName, lastName, role, site }

// ===================== PIN LOGIN =====================
const pinDotsEl = document.getElementById("pin-dots");
const loginErrorEl = document.getElementById("login-error");

document.getElementById("keypad").addEventListener("click", (e) => {
  const key = e.target.dataset.key;
  if (!key) return;

  if (key === "clear") {
    currentPin = "";
  } else if (key === "back") {
    currentPin = currentPin.slice(0, -1);
  } else {
    if (currentPin.length < 4) currentPin += key;
  }
  renderPinDots();

  if (currentPin.length === 4) {
    attemptLogin(currentPin);
  }
});

function renderPinDots() {
  const dots = pinDotsEl.querySelectorAll(".pin-dot");
  dots.forEach((dot, i) => {
    dot.classList.toggle("filled", i < currentPin.length);
  });
}

function attemptLogin(pin) {
  loginErrorEl.textContent = "";
  authReady.then(() => db.ref("users").orderByChild("pin").equalTo(pin).once("value"))
    .then((snap) => {
      if (!snap.exists()) {
        loginErrorEl.textContent = "Incorrect PIN. Try again.";
        currentPin = "";
        renderPinDots();
        return;
      }
      const usersObj = snap.val();
      const uid = Object.keys(usersObj)[0];
      const userData = usersObj[uid];

      if (userData.active === false) {
        loginErrorEl.textContent = "This account is inactive. Contact your admin.";
        currentPin = "";
        renderPinDots();
        return;
      }

      currentUser = { uid, ...userData };
      showAppShell();
    })
    .catch((err) => {
      loginErrorEl.textContent = "Login error — check your connection.";
      console.error(err);
      currentPin = "";
      renderPinDots();
    });
}

document.getElementById("forgot-pin-link").addEventListener("click", () => {
  document.getElementById("reset-pin-panel").style.display = "block";
  document.getElementById("forgot-pin-link").style.display = "none";
  loginErrorEl.textContent = "";
});

document.getElementById("reset-phone-cancel").addEventListener("click", () => {
  document.getElementById("reset-pin-panel").style.display = "none";
  document.getElementById("forgot-pin-link").style.display = "inline";
  document.getElementById("reset-phone-input").value = "";
  loginErrorEl.textContent = "";
});

document.getElementById("reset-phone-submit").addEventListener("click", () => {
  const phone = document.getElementById("reset-phone-input").value.trim();
  const submitBtn = document.getElementById("reset-phone-submit");

  if (!phone) {
    loginErrorEl.textContent = "Enter a phone number.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";
  loginErrorEl.textContent = "";

  const resetPinByPhone = functions.httpsCallable("resetPinByPhone");
  authReady
    .then(() => resetPinByPhone({ phone }))
    .then((result) => {
      loginErrorEl.style.color = "var(--success)";
      loginErrorEl.textContent = result.data.message;
      submitBtn.disabled = false;
      submitBtn.textContent = "Send new PIN";
    })
    .catch((err) => {
      console.error(err);
      loginErrorEl.style.color = "var(--danger)";
      loginErrorEl.textContent = "Something went wrong. Try again or contact your Superadmin.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Send new PIN";
    });
});

document.getElementById("logout-btn").addEventListener("click", () => {
  currentUser = null;
  currentPin = "";
  renderPinDots();
  document.getElementById("app-shell").classList.remove("active");
  document.getElementById("login-screen").style.display = "flex";
});

// ===================== APP SHELL / ROLE ROUTING =====================
function showAppShell() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app-shell").classList.add("active");

  document.getElementById("user-name-display").textContent =
    `${currentUser.firstName} ${currentUser.lastName}`;

  const roleInfo = ROLES[currentUser.role] || { label: currentUser.role };
  const badge = document.getElementById("role-badge-display");
  badge.textContent = roleInfo.label;
  badge.className = `role-badge ${currentUser.role}`;

  setupSiteSelector();
  renderTabsForRole(currentUser.role);
}

function setupSiteSelector() {
  const selector = document.getElementById("site-selector");
  selector.innerHTML = "";

  if (currentUser.role === "superadmin") {
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Sites";
    selector.appendChild(allOpt);
    Object.entries(SITES).forEach(([key, label]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = label;
      selector.appendChild(opt);
    });
  } else {
    // site-scoped roles: locked to their assigned site
    const opt = document.createElement("option");
    opt.value = currentUser.site;
    opt.textContent = SITES[currentUser.site] || currentUser.site;
    selector.appendChild(opt);
    selector.disabled = true;
  }
}

function renderTabsForRole(role) {
  const tabsEl = document.getElementById("main-tabs");
  tabsEl.innerHTML = "";

  let tabs = [];
  if (role === "superadmin" || role === "superuser") {
    tabs = [
      { id: "pre-event", label: "Pre-Event" },
      { id: "during-event", label: "During Event" },
      { id: "closing", label: "Closing" },
      { id: "out-of-order", label: "Out of Order" },
      { id: "admin", label: "Admin Panel" }
    ];
  } else if (role === "user") {
    tabs = [
      { id: "pre-event", label: "Pre-Event" },
      { id: "during-event", label: "During Event" },
      { id: "closing", label: "Closing" },
      { id: "out-of-order", label: "Flag a Unit" }
    ];
  } else if (role === "maintenance") {
    tabs = [
      { id: "out-of-order", label: "Flagged Units" }
    ];
  }

  tabs.forEach((tab, i) => {
    const btn = document.createElement("button");
    btn.textContent = tab.label;
    btn.dataset.tabId = tab.id;
    if (i === 0) btn.classList.add("active");
    btn.addEventListener("click", () => {
      tabsEl.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTabContent(tab.id);
    });
    tabsEl.appendChild(btn);
  });

  if (tabs.length) renderTabContent(tabs[0].id);
}

function renderTabContent(tabId) {
  const content = document.getElementById("main-content");

  if (tabId === "admin") {
    renderAdminPanel(content);
    return;
  }

  const labels = {
    "pre-event": "Pre-Event Task List",
    "during-event": "During-Event Task List",
    "closing": "Closing Task List",
    "out-of-order": currentUser.role === "maintenance" ? "Flagged Units" : "Out-of-Order Reports"
  };
  content.innerHTML = `
    <div class="panel-placeholder">
      <h3 style="margin-bottom:8px;color:var(--navy)">${labels[tabId]}</h3>
      <p>This section is scaffolded and ready for data binding — coming in the next build pass.</p>
    </div>
  `;
}

// ===================== ADMIN PANEL: UNITS CSV IMPORT =====================
function renderAdminPanel(content) {
  const isSuperadmin = currentUser.role === "superadmin";
  const siteOptions = isSuperadmin
    ? Object.entries(SITES).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")
    : `<option value="${currentUser.site}">${SITES[currentUser.site]}</option>`;

  content.innerHTML = `
    <div class="card">
      <h3 style="color:var(--navy); margin-bottom:14px;">Import Privy Units (CSV)</h3>
      <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">
        CSV columns required: <code>unit_name, location, type</code> (type must be Male, Female, or ADA).
        Importing <strong>replaces all units</strong> for the selected site — existing units for that site will be overwritten.
      </p>
      <label style="display:block; font-size:0.85rem; margin-bottom:6px; color:var(--muted);">Site</label>
      <select id="admin-site-select" style="padding:8px; border-radius:6px; border:1px solid var(--border); margin-bottom:14px; width:200px;">
        ${siteOptions}
      </select>
      <br>
      <button id="csv-template-btn" style="padding:8px 14px; background:none; border:1px solid var(--navy); color:var(--navy); border-radius:6px; cursor:pointer; margin-bottom:14px;">
        Download blank template for this site
      </button>
      <br>
      <input type="file" id="csv-file-input" accept=".csv" style="margin-bottom:14px;">
      <br>
      <button id="csv-import-btn" style="padding:10px 18px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">
        Import CSV
      </button>
      <div id="csv-import-status" style="margin-top:12px; font-size:0.85rem;"></div>
    </div>
    <div class="card">
      <h3 style="color:var(--navy); margin-bottom:14px;">Current Units — <span id="units-table-site-label"></span></h3>
      <div id="units-table-container">
        <p style="color:var(--muted);">Select a site above to view its units.</p>
      </div>
    </div>
  `;

  const siteSelect = document.getElementById("admin-site-select");
  siteSelect.addEventListener("change", () => loadUnitsTable(siteSelect.value));
  loadUnitsTable(siteSelect.value);

  document.getElementById("csv-template-btn").addEventListener("click", () => {
    const site = siteSelect.value;
    const csvContent = "unit_name,location,type\nPrivy 1,Main Gate,Male\nPrivy 2,Main Gate,Female\nPrivy 3,Main Gate,ADA\n";
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `privy-check-units-${site}-template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById("csv-import-btn").addEventListener("click", () => {
    const fileInput = document.getElementById("csv-file-input");
    const site = siteSelect.value;
    const statusEl = document.getElementById("csv-import-status");

    if (!fileInput.files.length) {
      statusEl.style.color = "var(--danger)";
      statusEl.textContent = "Choose a CSV file first.";
      return;
    }

    const file = fileInput.files[0];
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data;
        const errors = [];
        const units = {};

        rows.forEach((row, i) => {
          const name = (row.unit_name || "").trim();
          const location = (row.location || "").trim();
          const type = (row.type || "").trim();

          if (!name) { errors.push(`Row ${i + 2}: missing unit_name`); return; }
          if (!["Male", "Female", "ADA"].includes(type)) {
            errors.push(`Row ${i + 2}: type "${type}" must be Male, Female, or ADA`);
            return;
          }

          const unitKey = name.replace(/[.#$/\[\]]/g, "_");
          units[unitKey] = { name, location, type, status: "ok" };
        });

        if (errors.length) {
          statusEl.style.color = "var(--danger)";
          statusEl.innerHTML = `Found ${errors.length} problem(s), nothing was imported:<br>` + errors.join("<br>");
          return;
        }

        const unitCount = Object.keys(units).length;
        if (!confirm(`Import ${unitCount} units for ${SITES[site]}? This replaces all existing units for this site.`)) {
          statusEl.textContent = "Import cancelled.";
          return;
        }

        db.ref(`sites/${site}/units`).set(units)
          .then(() => {
            statusEl.style.color = "var(--success)";
            statusEl.textContent = `Imported ${unitCount} units for ${SITES[site]}.`;
            fileInput.value = "";
            loadUnitsTable(site);
          })
          .catch((err) => {
            statusEl.style.color = "var(--danger)";
            statusEl.textContent = "Import failed: " + err.message;
          });
      },
      error: (err) => {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Could not parse CSV: " + err.message;
      }
    });
  });
}

function loadUnitsTable(site) {
  document.getElementById("units-table-site-label").textContent = SITES[site] || site;
  const container = document.getElementById("units-table-container");
  container.innerHTML = "<p style='color:var(--muted);'>Loading...</p>";

  db.ref(`sites/${site}/units`).once("value").then((snap) => {
    if (!snap.exists()) {
      container.innerHTML = "<p style='color:var(--muted);'>No units imported yet for this site.</p>";
      return;
    }
    const units = snap.val();
    const rows = Object.values(units).map(u =>
      `<tr>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${u.name}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${u.location || "—"}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${u.type}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${u.status}</td>
      </tr>`
    ).join("");

    container.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead>
          <tr style="text-align:left; color:var(--muted);">
            <th style="padding:8px; border-bottom:2px solid var(--border);">Unit</th>
            <th style="padding:8px; border-bottom:2px solid var(--border);">Location</th>
            <th style="padding:8px; border-bottom:2px solid var(--border);">Type</th>
            <th style="padding:8px; border-bottom:2px solid var(--border);">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  });
}
