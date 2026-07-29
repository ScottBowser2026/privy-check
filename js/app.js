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

  selector.addEventListener("change", () => {
    const activeTabBtn = document.querySelector("#main-tabs button.active");
    if (activeTabBtn) renderTabContent(activeTabBtn.dataset.tabId);
  });
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

  if (tabId === "out-of-order") {
    if (currentUser.role === "user") renderFlagUnitForm(content);
    else if (currentUser.role === "maintenance") renderMaintenanceQueue(content);
    else renderOutOfOrderManagement(content); // superadmin / superuser
    return;
  }

  const labels = {
    "pre-event": "Pre-Event Task List",
    "during-event": "During-Event Task List",
    "closing": "Closing Task List"
  };
  content.innerHTML = `
    <div class="panel-placeholder">
      <h3 style="margin-bottom:8px;color:var(--navy)">${labels[tabId]}</h3>
      <p>This section is scaffolded and ready for data binding — coming in the next build pass.</p>
    </div>
  `;
}

// ===================== OUT-OF-ORDER: USER FLAGS A UNIT =====================
function renderFlagUnitForm(content) {
  const site = currentUser.site;
  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading units...</p></div>`;

  db.ref(`sites/${site}/units`).once("value").then((snap) => {
    if (!snap.exists()) {
      content.innerHTML = `<div class="panel-placeholder">No units have been imported for ${SITES[site]} yet. Ask your Superadmin to import units in the Admin Panel.</div>`;
      return;
    }
    const units = snap.val();
    const unitOptions = Object.entries(units)
      .map(([key, u]) => `<option value="${key}">${u.name} — ${u.type}${u.status === "outOfOrder" ? " (already flagged)" : ""}</option>`)
      .join("");
    const reasonOptions = DEFAULT_OOO_REASONS.map(r => `<option value="${r}">${r}</option>`).join("");

    content.innerHTML = `
      <div class="card">
        <h3 style="color:var(--navy); margin-bottom:14px;">Flag a Unit — ${SITES[site]}</h3>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Unit</label>
        <select id="flag-unit-select" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:6px; margin-bottom:14px;">
          ${unitOptions}
        </select>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Suspected reason</label>
        <select id="flag-reason-select" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:6px; margin-bottom:14px;">
          ${reasonOptions}
        </select>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Additional notes</label>
        <textarea id="flag-notes-input" rows="3" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:6px; margin-bottom:14px; font-family:inherit;" placeholder="Optional details..."></textarea>
        <button id="flag-submit-btn" style="padding:10px 20px; background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600;">
          Flag This Unit
        </button>
        <div id="flag-status-msg" style="margin-top:12px; font-size:0.85rem;"></div>
      </div>
    `;

    document.getElementById("flag-submit-btn").addEventListener("click", () => {
      const unitKey = document.getElementById("flag-unit-select").value;
      const unitName = units[unitKey].name;
      const reason = document.getElementById("flag-reason-select").value;
      const notes = document.getElementById("flag-notes-input").value.trim();
      const statusMsg = document.getElementById("flag-status-msg");

      const flagRef = db.ref(`sites/${site}/outOfOrder`).push();
      const flagData = {
        unitKey, unitName, reason, notes,
        flaggedByUid: currentUser.uid,
        flaggedByName: `${currentUser.firstName} ${currentUser.lastName}`,
        flaggedAt: firebase.database.ServerValue.TIMESTAMP,
        status: "open"
      };

      flagRef.set(flagData)
        .then(() => db.ref(`sites/${site}/units/${unitKey}/status`).set("outOfOrder"))
        .then(() => {
          statusMsg.style.color = "var(--success)";
          statusMsg.textContent = `${unitName} flagged as out of order. Your Super User has been notified.`;
          document.getElementById("flag-notes-input").value = "";
        })
        .catch((err) => {
          statusMsg.style.color = "var(--danger)";
          statusMsg.textContent = "Failed to submit flag: " + err.message;
        });
    });
  });
}

// ===================== OUT-OF-ORDER: SUPERADMIN / SUPERUSER MANAGEMENT =====================
function renderOutOfOrderManagement(content) {
  const topSelector = document.getElementById("site-selector");
  const selectedSite = topSelector.value;
  const sitesToShow = (currentUser.role === "superadmin" && selectedSite === "all")
    ? Object.keys(SITES)
    : [currentUser.role === "superadmin" ? selectedSite : currentUser.site];

  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading reports...</p></div>`;

  const allFlags = [];
  const fetches = sitesToShow.map(site =>
    db.ref(`sites/${site}/outOfOrder`).once("value").then(snap => {
      if (snap.exists()) {
        snap.forEach(child => allFlags.push({ site, flagId: child.key, ...child.val() }));
      }
    })
  );

  Promise.all(fetches).then(() => {
    db.ref("users").once("value").then((usersSnap) => {
      const maintenanceBySite = {};
      usersSnap.forEach((child) => {
        const u = child.val();
        if (u.role === "maintenance" && u.active !== false && u.isMOD) {
          if (!maintenanceBySite[u.site]) maintenanceBySite[u.site] = [];
          maintenanceBySite[u.site].push({ uid: child.key, name: `${u.firstName} ${u.lastName}` });
        }
      });

      if (!allFlags.length) {
        content.innerHTML = `<div class="panel-placeholder">No out-of-order reports for ${sitesToShow.length > 1 ? "any site" : SITES[sitesToShow[0]]} right now.</div>`;
        return;
      }

      allFlags.sort((a, b) => (b.flaggedAt || 0) - (a.flaggedAt || 0));

      const rowsHtml = allFlags.map(f => {
        const when = f.flaggedAt ? new Date(f.flaggedAt).toLocaleString() : "—";
        const techs = maintenanceBySite[f.site] || [];
        const techOptions = `<option value="">Unassigned</option>` + techs.map(t =>
          `<option value="${t.uid}" ${f.assignedToUid === t.uid ? "selected" : ""}>${t.name}</option>`
        ).join("");

        const statusBadge = {
          open: `<span style="color:var(--danger); font-weight:600;">Open</span>`,
          assigned: `<span style="color:var(--warn); font-weight:600;">Assigned</span>`,
          closed: `<span style="color:var(--success); font-weight:600;">Resolved</span>`
        }[f.status] || f.status;

        return `
          <div class="card" style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
              <div>
                <strong>${f.unitName}</strong> ${sitesToShow.length > 1 ? `<span style="color:var(--muted); font-size:0.8rem;">(${SITES[f.site]})</span>` : ""}
                <div style="color:var(--muted); font-size:0.85rem; margin-top:4px;">${f.reason}${f.notes ? " — " + f.notes : ""}</div>
                <div style="color:var(--muted); font-size:0.75rem; margin-top:4px;">Flagged by ${f.flaggedByName} · ${when}</div>
                ${f.status === "open" && f.wasReassigned ? `<div style="color:var(--warn); font-size:0.8rem; margin-top:4px;">⚠ Maintenance reported this still needs repair</div>` : ""}
              </div>
              <div style="text-align:right;">
                <div style="margin-bottom:6px;">${statusBadge}</div>
                <select class="assign-select" data-site="${f.site}" data-flag-id="${f.flagId}" style="padding:6px; border-radius:6px; border:1px solid var(--border);" ${f.status === "closed" ? "disabled" : ""}>
                  ${techOptions}
                </select>
              </div>
            </div>
          </div>
        `;
      }).join("");

      content.innerHTML = rowsHtml;

      content.querySelectorAll(".assign-select").forEach((select) => {
        select.addEventListener("change", () => {
          const site = select.dataset.site;
          const flagId = select.dataset.flagId;
          const uid = select.value;
          const techName = select.options[select.selectedIndex].text;

          const updates = uid
            ? { assignedToUid: uid, assignedToName: techName, assignedAt: firebase.database.ServerValue.TIMESTAMP, status: "assigned", wasReassigned: false }
            : { assignedToUid: null, assignedToName: null, status: "open" };

          db.ref(`sites/${site}/outOfOrder/${flagId}`).update(updates)
            .catch((err) => alert("Failed to assign: " + err.message));
        });
      });
    });
  });
}

// ===================== OUT-OF-ORDER: MAINTENANCE QUEUE =====================
function renderMaintenanceQueue(content) {
  const site = currentUser.site;
  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading assigned units...</p></div>`;

  db.ref(`sites/${site}/outOfOrder`).once("value").then((snap) => {
    const myFlags = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const f = child.val();
        if (f.assignedToUid === currentUser.uid && f.status === "assigned") {
          myFlags.push({ flagId: child.key, ...f });
        }
      });
    }

    if (!myFlags.length) {
      content.innerHTML = `<div class="panel-placeholder">No units currently assigned to you.</div>`;
      return;
    }

    myFlags.sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));

    content.innerHTML = myFlags.map(f => {
      const when = f.assignedAt ? new Date(f.assignedAt).toLocaleString() : "—";
      return `
        <div class="card" style="margin-bottom:10px;">
          <strong>${f.unitName}</strong>
          <div style="color:var(--muted); font-size:0.85rem; margin:6px 0;">${f.reason}${f.notes ? " — " + f.notes : ""}</div>
          <div style="color:var(--muted); font-size:0.75rem; margin-bottom:12px;">Assigned ${when}</div>
          <button class="complete-btn" data-flag-id="${f.flagId}" data-unit-key="${f.unitKey}" style="padding:8px 16px; background:var(--success); color:white; border:none; border-radius:6px; cursor:pointer; margin-right:8px;">
            Mark Completed
          </button>
          <button class="needs-repair-btn" data-flag-id="${f.flagId}" style="padding:8px 16px; background:var(--warn); color:white; border:none; border-radius:6px; cursor:pointer;">
            Still Needs Repair
          </button>
        </div>
      `;
    }).join("");

    content.querySelectorAll(".complete-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const flagId = btn.dataset.flagId;
        const unitKey = btn.dataset.unitKey;
        db.ref(`sites/${site}/outOfOrder/${flagId}`).update({
          status: "closed",
          resolvedByUid: currentUser.uid,
          resolvedByName: `${currentUser.firstName} ${currentUser.lastName}`,
          resolvedAt: firebase.database.ServerValue.TIMESTAMP
        })
        .then(() => db.ref(`sites/${site}/units/${unitKey}/status`).set("ok"))
        .then(() => renderMaintenanceQueue(content))
        .catch((err) => alert("Failed to mark completed: " + err.message));
      });
    });

    content.querySelectorAll(".needs-repair-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const flagId = btn.dataset.flagId;
        db.ref(`sites/${site}/outOfOrder/${flagId}`).update({
          status: "open",
          assignedToUid: null,
          assignedToName: null,
          wasReassigned: true
        })
        .then(() => renderMaintenanceQueue(content))
        .catch((err) => alert("Failed to update: " + err.message));
      });
    });
  });
}

// ===================== ADMIN PANEL: UNITS CSV IMPORT =====================
function renderAdminPanel(content) {
  const isSuperadmin = currentUser.role === "superadmin";
  const siteOptions = isSuperadmin
    ? Object.entries(SITES).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")
    : `<option value="${currentUser.site}">${SITES[currentUser.site]}</option>`;

  const sandboxCard = isSuperadmin ? `
    <div class="card">
      <h3 style="color:var(--navy); margin-bottom:14px;">Sandbox Mode</h3>
      <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">
        When ON, no real texts are sent (PIN resets, and future out-of-order alerts). Actions are logged instead, and PIN reset shows you the generated PIN directly on screen for testing.
      </p>
      <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
        <input type="checkbox" id="sandbox-mode-toggle" style="width:20px; height:20px; cursor:pointer;">
        <span id="sandbox-mode-label" style="font-weight:600;">Loading...</span>
      </label>
      <h4 style="margin-top:20px; margin-bottom:10px; color:var(--navy); font-size:0.9rem;">Recent SMS Log</h4>
      <div id="sms-log-container"><p style="color:var(--muted); font-size:0.85rem;">Loading...</p></div>
    </div>
  ` : "";

  content.innerHTML = sandboxCard + `
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
    <div class="card">
      <h3 style="color:var(--navy); margin-bottom:14px;">Staff — <span id="staff-table-site-label"></span></h3>
      <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">
        Toggle "MOD" (Manager/Maintenance on Duty) for Super Users and Maintenance staff who are currently on shift and should receive alerts / be assignable. Multiple people can be MOD at once.
      </p>
      <div id="staff-table-container">
        <p style="color:var(--muted);">Select a site above to view staff.</p>
      </div>
    </div>
    <div class="card">
      <h3 style="color:var(--navy); margin-bottom:14px;">Import Staff (CSV)</h3>
      <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">
        CSV columns required: <code>first_name, last_name, email, phone, role, site, pin</code>.
        Phone is optional at import — but anyone without a phone on file can't use "Forgot PIN?" text reset until one is added (editable below in the staff list).
        Role must be superadmin / superuser / user / maintenance. Site can be blank for superadmin (defaults to "all").
        Leave <code>pin</code> blank to auto-generate a unique 4-digit PIN. This <strong>adds</strong> new staff — it does not remove existing users.
      </p>
      <button id="staff-template-btn" style="padding:8px 14px; background:none; border:1px solid var(--navy); color:var(--navy); border-radius:6px; cursor:pointer; margin-bottom:14px;">
        Download staff template
      </button>
      <br>
      <input type="file" id="staff-csv-input" accept=".csv" style="margin-bottom:14px;">
      <br>
      <button id="staff-import-btn" style="padding:10px 18px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">
        Import Staff CSV
      </button>
      <div id="staff-import-status" style="margin-top:12px; font-size:0.85rem;"></div>
    </div>
  `;

  const siteSelect = document.getElementById("admin-site-select");
  siteSelect.addEventListener("change", () => {
    loadUnitsTable(siteSelect.value);
    loadStaffTable(siteSelect.value);
  });
  loadUnitsTable(siteSelect.value);
  loadStaffTable(siteSelect.value);

  if (isSuperadmin) {
    setupSandboxModeToggle();
    loadSmsLog();
  }

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
        const nameTypeCounts = {};

        rows.forEach((row, i) => {
          const name = (row.unit_name || "").trim();
          const location = (row.location || "").trim();
          const type = (row.type || "").trim();

          if (!name) { errors.push(`Row ${i + 2}: missing unit_name`); return; }
          if (!["Male", "Female", "ADA"].includes(type)) {
            errors.push(`Row ${i + 2}: type "${type}" must be Male, Female, or ADA`);
            return;
          }

          // Same location name can have multiple facilities of the same type
          // (e.g. "King Loo" with 2 ADA stalls) — track an occurrence count so
          // every row gets a unique key instead of overwriting the previous one.
          const baseKey = `${name}__${type}`.replace(/[.#$/\[\]]/g, "_");
          nameTypeCounts[baseKey] = (nameTypeCounts[baseKey] || 0) + 1;
          const occurrence = nameTypeCounts[baseKey];
          const unitKey = occurrence > 1 ? `${baseKey}_${occurrence}` : baseKey;

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

  // ---------- Staff import ----------
  document.getElementById("staff-template-btn").addEventListener("click", () => {
    const csvContent = "first_name,last_name,email,phone,role,site,pin\nJane,Smith,jane.smith@example.com,7175551001,superuser,parf,\nJohn,Doe,john.doe@example.com,7175551002,user,parf,\n";
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "privy-check-staff-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById("staff-import-btn").addEventListener("click", () => {
    const fileInput = document.getElementById("staff-csv-input");
    const statusEl = document.getElementById("staff-import-status");
    const VALID_ROLES = ["superadmin", "superuser", "user", "maintenance"];

    if (!fileInput.files.length) {
      statusEl.style.color = "var(--danger)";
      statusEl.textContent = "Choose a CSV file first.";
      return;
    }

    statusEl.style.color = "var(--muted)";
    statusEl.textContent = "Checking existing PINs...";

    db.ref("users").once("value").then((existingSnap) => {
      const usedPins = new Set();
      existingSnap.forEach((child) => {
        if (child.val().pin) usedPins.add(child.val().pin);
      });

      function generateUniquePin() {
        let candidate, attempts = 0;
        do {
          candidate = String(Math.floor(1000 + Math.random() * 9000));
          attempts++;
        } while (usedPins.has(candidate) && attempts < 100);
        usedPins.add(candidate);
        return candidate;
      }

      const file = fileInput.files[0];
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data;
          const errors = [];
          const newUsers = {};

          rows.forEach((row, i) => {
            const firstName = (row.first_name || "").trim();
            const lastName = (row.last_name || "").trim();
            const email = (row.email || "").trim();
            const phone = (row.phone || "").trim();
            const role = (row.role || "").trim().toLowerCase();
            let site = (row.site || "").trim().toLowerCase();
            let pin = (row.pin || "").trim();

            if (!firstName || !lastName) { errors.push(`Row ${i + 2}: missing first/last name`); return; }
            if (!VALID_ROLES.includes(role)) { errors.push(`Row ${i + 2}: role "${role}" must be superadmin, superuser, user, or maintenance`); return; }
            if (role === "superadmin") {
              site = "all";
            } else if (!Object.keys(SITES).includes(site)) {
              errors.push(`Row ${i + 2}: site "${site}" must be parf, srf, krf, or garf`);
              return;
            }

            if (pin) {
              if (usedPins.has(pin)) { errors.push(`Row ${i + 2}: PIN "${pin}" is already in use`); return; }
              usedPins.add(pin);
            } else {
              pin = generateUniquePin();
            }

            const uidKey = `staff_${Date.now()}_${i}`;
            newUsers[uidKey] = { firstName, lastName, email, phone, role, site, pin, active: true };
          });

          if (errors.length) {
            statusEl.style.color = "var(--danger)";
            statusEl.innerHTML = `Found ${errors.length} problem(s), nothing was imported:<br>` + errors.join("<br>");
            return;
          }

          const updates = {};
          Object.entries(newUsers).forEach(([uid, data]) => {
            updates[`users/${uid}`] = data;
          });

          db.ref().update(updates)
            .then(() => {
              const summary = Object.entries(newUsers)
                .map(([, u]) => `${u.firstName} ${u.lastName} — PIN ${u.pin} (${u.role}${u.site !== "all" ? ", " + SITES[u.site] : ""})`)
                .join("<br>");
              statusEl.style.color = "var(--success)";
              statusEl.innerHTML = `Imported ${Object.keys(newUsers).length} staff member(s):<br>${summary}`;
              fileInput.value = "";
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
  });
}

function setupSandboxModeToggle() {
  const toggle = document.getElementById("sandbox-mode-toggle");
  const label = document.getElementById("sandbox-mode-label");

  db.ref("settings/sandboxMode").once("value").then((snap) => {
    const isOn = snap.val() === true;
    toggle.checked = isOn;
    label.textContent = isOn ? "ON — no real texts are being sent" : "OFF — texts send normally";
    label.style.color = isOn ? "var(--warn)" : "var(--success)";
  });

  toggle.addEventListener("change", () => {
    db.ref("settings/sandboxMode").set(toggle.checked)
      .then(() => {
        label.textContent = toggle.checked ? "ON — no real texts are being sent" : "OFF — texts send normally";
        label.style.color = toggle.checked ? "var(--warn)" : "var(--success)";
      })
      .catch((err) => {
        alert("Failed to update sandbox mode: " + err.message);
        toggle.checked = !toggle.checked;
      });
  });
}

function loadSmsLog() {
  const container = document.getElementById("sms-log-container");
  db.ref("smsLog").limitToLast(10).once("value").then((snap) => {
    if (!snap.exists()) {
      container.innerHTML = "<p style='color:var(--muted); font-size:0.85rem;'>No SMS activity logged yet.</p>";
      return;
    }
    const entries = [];
    snap.forEach((child) => entries.push(child.val()));
    entries.reverse();

    const rows = entries.map(e => {
      const when = e.timestamp ? new Date(e.timestamp).toLocaleString() : "—";
      const badge = e.sentReal
        ? `<span style="color:var(--success);">sent</span>`
        : `<span style="color:var(--warn);">sandbox (logged only)</span>`;
      return `<tr>
        <td style="padding:6px; border-bottom:1px solid var(--border); font-size:0.8rem;">${when}</td>
        <td style="padding:6px; border-bottom:1px solid var(--border); font-size:0.8rem;">${e.to}</td>
        <td style="padding:6px; border-bottom:1px solid var(--border); font-size:0.8rem;">${e.type}</td>
        <td style="padding:6px; border-bottom:1px solid var(--border); font-size:0.8rem;">${badge}</td>
      </tr>`;
    }).join("");

    container.innerHTML = `
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="text-align:left; color:var(--muted); font-size:0.75rem;">
            <th style="padding:6px; border-bottom:2px solid var(--border);">When</th>
            <th style="padding:6px; border-bottom:2px solid var(--border);">To</th>
            <th style="padding:6px; border-bottom:2px solid var(--border);">Type</th>
            <th style="padding:6px; border-bottom:2px solid var(--border);">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  });
}

function loadStaffTable(site) {
  document.getElementById("staff-table-site-label").textContent = SITES[site] || site;
  const container = document.getElementById("staff-table-container");
  container.innerHTML = "<p style='color:var(--muted);'>Loading...</p>";

  db.ref("users").once("value").then((snap) => {
    if (!snap.exists()) {
      container.innerHTML = "<p style='color:var(--muted);'>No staff yet.</p>";
      return;
    }

    const relevantUsers = [];
    snap.forEach((child) => {
      const u = child.val();
      if (u.site === site || u.role === "superadmin") {
        relevantUsers.push({ uid: child.key, ...u });
      }
    });

    if (!relevantUsers.length) {
      container.innerHTML = "<p style='color:var(--muted);'>No staff for this site yet.</p>";
      return;
    }

    const isSuperadminViewer = currentUser.role === "superadmin";

    const rows = relevantUsers.map(u => {
      const modCell = (u.role === "superuser" || u.role === "maintenance")
        ? `<input type="checkbox" class="mod-toggle" data-uid="${u.uid}" ${u.isMOD ? "checked" : ""} style="width:18px; height:18px; cursor:pointer;">`
        : `<span style="color:var(--border);">—</span>`;
      const pinCell = isSuperadminViewer
        ? `<input type="text" class="pin-edit" data-uid="${u.uid}" value="${u.pin || ""}" maxlength="4" style="width:60px; padding:4px; border:1px solid var(--border); border-radius:4px;">
           <button class="pin-save-btn" data-uid="${u.uid}" style="padding:4px 8px; font-size:0.75rem; background:var(--navy); color:white; border:none; border-radius:4px; cursor:pointer; margin-left:4px;">Save</button>`
        : "";
      const phoneCell = `
        <input type="tel" class="phone-edit" data-uid="${u.uid}" value="${u.phone || ""}" placeholder="717-555-0100"
          style="width:130px; padding:4px; border:1px solid var(--border); border-radius:4px;">
        <button class="phone-save-btn" data-uid="${u.uid}" style="padding:4px 8px; font-size:0.75rem; background:var(--navy); color:white; border:none; border-radius:4px; cursor:pointer; margin-left:4px;">Save</button>
      `;
      return `<tr>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${u.firstName} ${u.lastName}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${ROLES[u.role] ? ROLES[u.role].label : u.role}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border); white-space:nowrap;">${phoneCell}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border); text-align:center;">${modCell}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${u.active === false ? "Inactive" : "Active"}</td>
        ${isSuperadminViewer ? `<td style="padding:8px; border-bottom:1px solid var(--border); white-space:nowrap;">${pinCell}</td>` : ""}
      </tr>`;
    }).join("");

    const pinHeader = isSuperadminViewer
      ? `<th style="padding:8px; border-bottom:2px solid var(--border);">PIN</th>`
      : "";

    container.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead>
          <tr style="text-align:left; color:var(--muted);">
            <th style="padding:8px; border-bottom:2px solid var(--border);">Name</th>
            <th style="padding:8px; border-bottom:2px solid var(--border);">Role</th>
            <th style="padding:8px; border-bottom:2px solid var(--border);">Phone</th>
            <th style="padding:8px; border-bottom:2px solid var(--border); text-align:center;">MOD</th>
            <th style="padding:8px; border-bottom:2px solid var(--border);">Status</th>
            ${pinHeader}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    container.querySelectorAll(".mod-toggle").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const uid = checkbox.dataset.uid;
        db.ref(`users/${uid}/isMOD`).set(checkbox.checked)
          .catch((err) => {
            alert("Failed to update MOD status: " + err.message);
            checkbox.checked = !checkbox.checked;
          });
      });
    });

    container.querySelectorAll(".phone-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.dataset.uid;
        const input = container.querySelector(`.phone-edit[data-uid="${uid}"]`);
        const newPhone = input.value.trim();
        db.ref(`users/${uid}/phone`).set(newPhone)
          .then(() => {
            btn.textContent = "Saved";
            setTimeout(() => { btn.textContent = "Save"; }, 1200);
          })
          .catch((err) => alert("Failed to update phone: " + err.message));
      });
    });

    container.querySelectorAll(".pin-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.dataset.uid;
        const input = container.querySelector(`.pin-edit[data-uid="${uid}"]`);
        const newPin = input.value.trim();

        if (!/^\d{4}$/.test(newPin)) {
          alert("PIN must be exactly 4 digits.");
          return;
        }

        db.ref("users").once("value").then((allUsersSnap) => {
          let collision = false;
          allUsersSnap.forEach((child) => {
            if (child.key !== uid && child.val().pin === newPin) collision = true;
          });
          if (collision) {
            alert(`PIN ${newPin} is already in use by another staff member. Choose a different one.`);
            return;
          }
          db.ref(`users/${uid}/pin`).set(newPin)
            .then(() => alert("PIN updated."))
            .catch((err) => alert("Failed to update PIN: " + err.message));
        });
      });
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
