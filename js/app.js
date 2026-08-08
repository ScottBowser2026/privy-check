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
  maintenance: { label: "Maintenance", scope: "site" },
  preevent: { label: "Pre-Event", scope: "site" },
  executive: { label: "Executive", scope: "all" },
  inventory: { label: "Inventory", scope: "site" }
};

// Checks if a user (either currentUser, or a raw record from /users during
// staff-table rendering) holds a given role. Works with both the new "roles"
// object and legacy single "role" string records.
function hasRole(userObj, roleKey) {
  if (!userObj) return false;
  if (userObj.roles) return !!userObj.roles[roleKey];
  return userObj.role === roleKey;
}

function getUserRoleKeys(userObj) {
  if (!userObj) return [];
  if (userObj.roles) return Object.keys(userObj.roles).filter(k => userObj.roles[k]);
  return userObj.role ? [userObj.role] : [];
}

function formatRoleLabels(userObj) {
  const keys = getUserRoleKeys(userObj);
  if (!keys.length) return "—";
  return keys.map(k => ROLES[k] ? ROLES[k].label : k).join(", ");
}

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
      // Normalize: old records have a single "role" string, new records have a
      // "roles" object ({user: true, preevent: true}). Support both so nothing
      // that was set up before this change breaks.
      if (!currentUser.roles) {
        currentUser.roles = currentUser.role ? { [currentUser.role]: true } : {};
      }
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

  const roleKeys = getUserRoleKeys(currentUser);
  const badge = document.getElementById("role-badge-display");
  badge.innerHTML = roleKeys.map(k =>
    `<span class="role-badge ${k}" style="margin-right:4px;">${ROLES[k] ? ROLES[k].label : k}</span>`
  ).join("");

  setupSiteSelector();
  renderTabsForRoles(roleKeys);
}

function setupSiteSelector() {
  const selector = document.getElementById("site-selector");
  selector.innerHTML = "";

  if (hasRole(currentUser, "superadmin")) {
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

// Each role contributes a list of tabs. IDs are unique per distinct view so
// that someone holding multiple roles (e.g. Maintenance + User) gets both
// views as separate tabs rather than one clobbering the other.
const ROLE_TABS = {
  superadmin: [
    { id: "pre-event-admin", label: "Pre-Event Setup" },
    { id: "during-event", label: "During Event" },
    { id: "closing-history", label: "Closing (History)" },
    { id: "oor-manage", label: "Out of Order (Manage)" },
    { id: "admin", label: "Admin Panel" }
  ],
  superuser: [
    { id: "pre-event-admin", label: "Pre-Event Setup" },
    { id: "during-event", label: "During Event" },
    { id: "closing-history", label: "Closing (History)" },
    { id: "oor-manage", label: "Out of Order (Manage)" },
    { id: "admin", label: "Admin Panel" }
  ],
  user: [
    { id: "during-event", label: "During Event" },
    { id: "closing-entry", label: "Closing Count" },
    { id: "oor-flag", label: "Flag a Unit" },
    { id: "request-supplies", label: "Request Supplies" }
  ],
  maintenance: [
    { id: "oor-queue", label: "Flagged Units" },
    { id: "supplies", label: "Log Supplies" }
  ],
  preevent: [
    { id: "pre-event-entry", label: "Pre-Event Count" }
  ],
  executive: [
    { id: "reports", label: "Reports" }
  ],
  inventory: [
    { id: "orders", label: "Orders" }
  ]
};

function renderTabsForRoles(roleKeys) {
  const tabsEl = document.getElementById("main-tabs");
  tabsEl.innerHTML = "";

  const seen = new Set();
  const tabs = [];
  roleKeys.forEach((role) => {
    (ROLE_TABS[role] || []).forEach((tab) => {
      if (!seen.has(tab.id)) {
        seen.add(tab.id);
        tabs.push(tab);
      }
    });
  });

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

  if (tabId === "oor-flag") {
    renderFlagUnitForm(content);
    return;
  }
  if (tabId === "oor-queue") {
    renderMaintenanceQueue(content);
    return;
  }
  if (tabId === "oor-manage") {
    renderOutOfOrderManagement(content);
    return;
  }

  if (tabId === "pre-event-admin") {
    renderPreEventAdminPanel(content);
    return;
  }
  if (tabId === "pre-event-entry") {
    renderInventoryCountEntry(content, "beginning", "Beginning Inventory Count");
    return;
  }

  if (tabId === "closing-entry") {
    renderInventoryCountEntry(content, "ending", "Ending Inventory Count");
    return;
  }
  if (tabId === "closing-history") {
    renderInventoryCountHistory(content);
    return;
  }

  if (tabId === "supplies") {
    renderInventoryCountEntry(content, "addition", "Log Supplies Brought");
    return;
  }

  if (tabId === "request-supplies") {
    renderSupplyRequestForm(content);
    return;
  }

  if (tabId === "orders") {
    renderInventoryOrders(content);
    return;
  }

  const labels = {
    "during-event": "During-Event Task List",
    "reports": "Reports"
  };
  content.innerHTML = `
    <div class="panel-placeholder">
      <h3 style="margin-bottom:8px;color:var(--navy)">${labels[tabId] || tabId}</h3>
      <p>This section is scaffolded and ready for data binding — coming in the next build pass.</p>
    </div>
  `;
}

// ===================== SHARED: LOCATION GROUPS (derived from imported units) =====================
// Multiple privy units (Male/Female/ADA) at the same physical spot share one name
// (e.g. "King Loo") — that name is the inventory group key. Groups are derived
// live from /sites/{site}/units rather than stored separately, so they always match.
function getLocationGroups(site) {
  return db.ref(`sites/${site}/units`).once("value").then((snap) => {
    const groups = {};
    if (snap.exists()) {
      Object.values(snap.val()).forEach((unit) => {
        const groupKey = unit.name.trim().replace(/[.#$/\[\]]/g, "_");
        if (!groups[groupKey]) groups[groupKey] = { name: unit.name.trim(), unitCount: 0 };
        groups[groupKey].unitCount++;
      });
    }
    return groups;
  });
}

// For User-role scope enforcement: returns the set of location-group keys that
// contain at least one unit assigned to this attendant.
function getAssignedGroupKeys(site, uid) {
  return db.ref(`sites/${site}/units`).once("value").then((snap) => {
    const keys = new Set();
    if (snap.exists()) {
      Object.values(snap.val()).forEach((unit) => {
        if (unit.assignedTo && unit.assignedTo[uid]) {
          keys.add(unit.name.trim().replace(/[.#$/\[\]]/g, "_"));
        }
      });
    }
    return keys;
  });
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
    const allUnits = snap.val();
    const units = Object.fromEntries(Object.entries(allUnits).filter(([, u]) => u.assignedTo && u.assignedTo[currentUser.uid]));

    if (!Object.keys(units).length) {
      content.innerHTML = `<div class="panel-placeholder">No units are currently assigned to you. Ask your Super User to assign you a unit in the Pre-Event tab.</div>`;
      return;
    }

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
  const sitesToShow = (hasRole(currentUser, "superadmin") && selectedSite === "all")
    ? Object.keys(SITES)
    : [hasRole(currentUser, "superadmin") ? selectedSite : currentUser.site];

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
        if (hasRole(u, "maintenance") && u.active !== false && u.isMOD) {
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

// ===================== PRE-EVENT: INVENTORY ITEMS ADMIN (Superadmin/Super User) =====================
const SUGGESTED_INVENTORY_ITEMS = [
  "Toilet Paper", "Paper Towels", "Hand Soap", "Hand Sanitizer", "Trash Bags",
  "Toilet Seat Covers", "Air Freshener", "Disinfectant Spray", "Gloves", "Urinal Screens"
];

// ===================== PRE-EVENT: COMBINED ADMIN PANEL (Open/Close toggles + Inventory Items) =====================
function renderPreEventAdminPanel(content) {
  content.innerHTML = `<div id="open-close-section"></div><div id="inventory-items-section"></div>`;
  renderUnitOpenCloseToggles(document.getElementById("open-close-section"));
  renderInventoryItemsAdmin(document.getElementById("inventory-items-section"));
}

function renderUnitOpenCloseToggles(container) {
  const topSelector = document.getElementById("site-selector");
  const site = hasRole(currentUser, "superadmin") ? topSelector.value : currentUser.site;

  if (hasRole(currentUser, "superadmin") && site === "all") {
    container.innerHTML = `<div class="card"><p style="color:var(--muted);">Pick a specific site above to manage unit open/closed status.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading units...</p></div>`;

  // Superadmin can always toggle. Super User can only toggle while flagged MOD (on duty) —
  // check their live status rather than the cached login-time value, since it can change mid-shift.
  const permissionCheck = hasRole(currentUser, "superadmin")
    ? Promise.resolve(true)
    : db.ref(`users/${currentUser.uid}/isMOD`).once("value").then(snap => snap.val() === true);

  Promise.all([
    permissionCheck,
    db.ref(`sites/${site}/units`).once("value"),
    db.ref("users").once("value")
  ]).then(([canToggle, unitsSnap, usersSnap]) => {
    if (!unitsSnap.exists()) {
      container.innerHTML = `<div class="card"><p style="color:var(--muted);">No units imported for ${SITES[site]} yet.</p></div>`;
      return;
    }
    const units = unitsSnap.val();

    const attendants = [];
    if (usersSnap.exists()) {
      usersSnap.forEach((child) => {
        const u = child.val();
        if (hasRole(u, "user") && u.site === site && u.active !== false) {
          attendants.push({ uid: child.key, name: `${u.firstName} ${u.lastName}` });
        }
      });
    }

    const rows = Object.entries(units).map(([key, unit]) => {
      const isOpen = unit.isOpen !== false; // default to open if never set
      const assignedUids = unit.assignedTo ? Object.keys(unit.assignedTo) : [];
      const assignedNames = assignedUids.map(uid => unit.assignedTo[uid]).join(", ") || "Unassigned";

      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border); flex-wrap:wrap; gap:8px;">
          <div>
            <strong>${unit.name}</strong> <span style="color:var(--muted); font-size:0.8rem;">${unit.type}${unit.location ? " — " + unit.location : ""}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            ${canToggle
              ? `<details class="unit-assign-details" data-key="${key}">
                  <summary style="cursor:pointer; padding:4px 10px; border:1px solid var(--border); border-radius:6px; font-size:0.8rem; display:inline-block;">${assignedNames} ▾</summary>
                  <div style="margin-top:6px; padding:8px; border:1px solid var(--border); border-radius:6px; background:#fafafa; min-width:180px;">
                    ${attendants.length
                      ? attendants.map(a => `
                          <label style="display:block; font-size:0.8rem; margin-bottom:4px; cursor:pointer;">
                            <input type="checkbox" class="unit-assign-checkbox" value="${a.uid}" data-name="${a.name}" ${assignedUids.includes(a.uid) ? "checked" : ""}> ${a.name}
                          </label>
                        `).join("")
                      : `<p style="color:var(--muted); font-size:0.8rem;">No User-role attendants for this site yet.</p>`
                    }
                    <button class="unit-assign-save-btn" data-key="${key}" style="margin-top:6px; padding:4px 10px; font-size:0.75rem; background:var(--navy); color:white; border:none; border-radius:4px; cursor:pointer;">Save</button>
                  </div>
                </details>`
              : `<span style="color:var(--muted); font-size:0.8rem;">${assignedNames}</span>`
            }
            ${canToggle
              ? `<button class="unit-open-toggle" data-key="${key}" data-open="${isOpen}" style="padding:6px 16px; border-radius:14px; border:none; cursor:pointer; font-weight:600; font-size:0.8rem; ${isOpen ? "background:var(--success); color:white;" : "background:var(--danger); color:white;"}">${isOpen ? "Open" : "Closed"}</button>`
              : `<span style="padding:4px 12px; border-radius:14px; font-size:0.75rem; font-weight:600; ${isOpen ? "background:#e2ede0; color:var(--success);" : "background:#f0dcd8; color:var(--danger);"}">${isOpen ? "Open" : "Closed"}</span>`
            }
          </div>
        </div>
      `;
    }).join("");

    container.innerHTML = `
      <div class="card">
        <h3 style="color:var(--navy); margin-bottom:8px;">Unit Status & Assignment — ${SITES[site]}</h3>
        <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">
          ${canToggle
            ? "Assign one or more attendants to each unit, and toggle it Open (ready for use) or Closed (not in service yet). Once assigned, an attendant's Flag/Closing/Request Supplies views only show units they're assigned to."
            : "View-only — you need to be marked MOD (on duty) to make changes. Ask your Superadmin to flip your MOD toggle in the Staff list."}
        </p>
        ${rows}
      </div>
    `;

    if (canToggle) {
      container.querySelectorAll(".unit-open-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const newOpen = btn.dataset.open !== "true";
          db.ref(`sites/${site}/units/${btn.dataset.key}/isOpen`).set(newOpen)
            .then(() => renderUnitOpenCloseToggles(container))
            .catch((err) => alert("Failed to update: " + err.message));
        });
      });

      container.querySelectorAll(".unit-assign-save-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.key;
          const details = container.querySelector(`.unit-assign-details[data-key="${key}"]`);
          const checked = Array.from(details.querySelectorAll(".unit-assign-checkbox:checked"));

          const assignedTo = {};
          checked.forEach(cb => { assignedTo[cb.value] = cb.dataset.name; });

          db.ref(`sites/${site}/units/${key}`).update({
            assignedTo: checked.length ? assignedTo : null,
            assignedToUid: null,  // clear legacy single-assignee field
            assignedToName: null
          })
            .then(() => renderUnitOpenCloseToggles(container))
            .catch((err) => alert("Failed to save assignment: " + err.message));
        });
      });
    }
  });
}

function renderInventoryItemsAdmin(content) {
  const topSelector = document.getElementById("site-selector");
  const site = hasRole(currentUser, "superadmin") ? topSelector.value : currentUser.site;

  if (hasRole(currentUser, "superadmin") && site === "all") {
    content.innerHTML = `<div class="panel-placeholder">Pick a specific site above to manage its inventory items — items are set up per site.</div>`;
    return;
  }

  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading location groups...</p></div>`;

  getLocationGroups(site).then((groups) => {
    const groupKeys = Object.keys(groups);
    if (!groupKeys.length) {
      content.innerHTML = `<div class="panel-placeholder">No units imported for ${SITES[site]} yet. Import units in the Admin Panel first — inventory groups are derived from unit names.</div>`;
      return;
    }

    const groupOptions = groupKeys.map(key =>
      `<option value="${key}">${groups[key].name} (${groups[key].unitCount} unit${groups[key].unitCount > 1 ? "s" : ""})</option>`
    ).join("");

    content.innerHTML = `
      <div class="card">
        <h3 style="color:var(--navy); margin-bottom:14px;">Inventory Items — ${SITES[site]}</h3>
        <p style="color:var(--muted); font-size:0.85rem; margin-bottom:10px;">
          Inventory is tracked per location group, split separately for Male and Female (units sharing a location name, e.g. "King Loo", share the group — but Male and Female supplies are tracked independently).
        </p>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Location group</label>
        <select id="inventory-group-select" style="width:100%; max-width:300px; padding:8px; border:1px solid var(--border); border-radius:6px; margin-bottom:16px;">
          ${groupOptions}
        </select>
        <div id="inventory-group-content"></div>
      </div>
    `;

    const groupSelect = document.getElementById("inventory-group-select");
    groupSelect.addEventListener("change", () => renderGroupItemsPanel(site, groupSelect.value, groups[groupSelect.value].name, "Female"));
    renderGroupItemsPanel(site, groupSelect.value, groups[groupSelect.value].name, "Female");
  });
}

function renderGroupItemsPanel(site, groupKey, groupName, sex) {
  const panel = document.getElementById("inventory-group-content");
  panel.innerHTML = `<p style="color:var(--muted);">Loading items...</p>`;

  db.ref(`sites/${site}/groupInventory/${groupKey}/${sex}/items`).once("value").then((snap) => {
    const items = snap.exists() ? snap.val() : {};
    const rows = Object.entries(items).map(([key, item]) => `
      <tr>
        <td style="padding:8px; border-bottom:1px solid var(--border);">
          ${item.name}
          ${item.parRaisedSuggested ? `<span title="A mid-event supply request came in for this item — consider raising the par level" style="color:var(--warn); font-size:0.75rem; margin-left:6px;">⚠ consider raising par</span>` : ""}
        </td>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${item.parLevel}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border);">
          <button class="delete-item-btn" data-key="${key}" style="padding:4px 10px; background:none; border:1px solid var(--danger); color:var(--danger); border-radius:4px; cursor:pointer; font-size:0.75rem;">Remove</button>
        </td>
      </tr>
    `).join("");

    const chipButtons = SUGGESTED_INVENTORY_ITEMS.map(name =>
      `<button class="suggested-chip" data-name="${name}" style="padding:5px 12px; margin:3px; background:#f4f2ee; border:1px solid var(--border); border-radius:14px; cursor:pointer; font-size:0.8rem;">${name}</button>`
    ).join("");

    panel.innerHTML = `
      <div style="display:flex; gap:8px; margin-bottom:16px;">
        <button class="sex-tab-btn" data-sex="Female" style="padding:8px 20px; border-radius:6px; border:1px solid var(--border); cursor:pointer; ${sex === "Female" ? "background:var(--navy); color:white;" : "background:white;"}">Female</button>
        <button class="sex-tab-btn" data-sex="Male" style="padding:8px 20px; border-radius:6px; border:1px solid var(--border); cursor:pointer; ${sex === "Male" ? "background:var(--navy); color:white;" : "background:white;"}">Male</button>
      </div>
      <p style="color:var(--muted); font-size:0.8rem; margin-bottom:6px;">Quick-add suggestions:</p>
      <div style="margin-bottom:16px;">${chipButtons}</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px;">
        <input type="text" id="new-item-name" placeholder="Item name" style="flex:2; min-width:160px; padding:8px; border:1px solid var(--border); border-radius:6px;">
        <input type="number" id="new-item-par" placeholder="Par level (cases)" step="0.25" min="0" style="flex:1; min-width:140px; padding:8px; border:1px solid var(--border); border-radius:6px;">
        <button id="add-item-btn" style="padding:8px 16px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">Add Item</button>
      </div>
      <div id="item-add-status" style="font-size:0.85rem; margin-bottom:14px;"></div>
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead>
          <tr style="text-align:left; color:var(--muted);">
            <th style="padding:8px; border-bottom:2px solid var(--border);">Item</th>
            <th style="padding:8px; border-bottom:2px solid var(--border);">Par Level (cases)</th>
            <th style="padding:8px; border-bottom:2px solid var(--border);"></th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="3" style="padding:8px; color:var(--muted);">No items yet — add some above.</td></tr>`}</tbody>
      </table>
    `;

    panel.querySelectorAll(".sex-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => renderGroupItemsPanel(site, groupKey, groupName, btn.dataset.sex));
    });

    function addItem(name, parLevel) {
      const statusEl = document.getElementById("item-add-status");
      if (!name.trim()) {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Item name is required.";
        return;
      }
      const key = name.trim().replace(/[.#$/\[\]]/g, "_");
      db.ref(`sites/${site}/groupInventory/${groupKey}/${sex}/items/${key}`).set({ name: name.trim(), parLevel: parseFloat(parLevel) || 0 })
        .then(() => renderGroupItemsPanel(site, groupKey, groupName, sex))
        .catch((err) => {
          statusEl.style.color = "var(--danger)";
          statusEl.textContent = "Failed to add: " + err.message;
        });
    }

    document.getElementById("add-item-btn").addEventListener("click", () => {
      addItem(document.getElementById("new-item-name").value, document.getElementById("new-item-par").value);
    });

    panel.querySelectorAll(".suggested-chip").forEach((chip) => {
      chip.addEventListener("click", () => addItem(chip.dataset.name, 1));
    });

    panel.querySelectorAll(".delete-item-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!confirm("Remove this item from the inventory list?")) return;
        db.ref(`sites/${site}/groupInventory/${groupKey}/${sex}/items/${btn.dataset.key}`).remove()
          .then(() => renderGroupItemsPanel(site, groupKey, groupName, sex))
          .catch((err) => alert("Failed to remove: " + err.message));
      });
    });
  });
}

// ===================== INVENTORY COUNT ENTRY (User closing count, or Maintenance supply restock) =====================
function renderInventoryCountEntry(content, type, title) {
  const site = currentUser.site;
  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading location groups...</p></div>`;

  // User-role attendants only see groups containing a unit assigned to them.
  // Maintenance and other roles that reach this screen see everything at their site.
  const scopePromise = hasRole(currentUser, "user")
    ? getAssignedGroupKeys(site, currentUser.uid)
    : Promise.resolve(null);

  Promise.all([getLocationGroups(site), scopePromise]).then(([allGroups, assignedKeys]) => {
    const groups = assignedKeys
      ? Object.fromEntries(Object.entries(allGroups).filter(([key]) => assignedKeys.has(key)))
      : allGroups;

    const groupKeys = Object.keys(groups);
    if (!groupKeys.length) {
      content.innerHTML = assignedKeys
        ? `<div class="panel-placeholder">No units are currently assigned to you. Ask your Super User to assign you a unit in the Pre-Event tab.</div>`
        : `<div class="panel-placeholder">No units imported for ${SITES[site]} yet.</div>`;
      return;
    }
    const groupOptions = groupKeys.map(key => `<option value="${key}">${groups[key].name}</option>`).join("");

    content.innerHTML = `
      <div class="card">
        <h3 style="color:var(--navy); margin-bottom:14px;">${title} — ${SITES[site]}</h3>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Location group</label>
        <select id="count-group-select" style="width:100%; max-width:300px; padding:8px; border:1px solid var(--border); border-radius:6px; margin-bottom:16px;">
          ${groupOptions}
        </select>
        <div id="count-group-content"></div>
      </div>
    `;

    const groupSelect = document.getElementById("count-group-select");
    groupSelect.addEventListener("change", () => renderGroupCountForm(site, groupSelect.value, groups[groupSelect.value].name, type));
    renderGroupCountForm(site, groupSelect.value, groups[groupSelect.value].name, type);
  });
}

function renderGroupCountForm(site, groupKey, groupName, type) {
  const panel = document.getElementById("count-group-content");
  panel.innerHTML = `<p style="color:var(--muted);">Loading items...</p>`;

  Promise.all([
    db.ref(`sites/${site}/groupInventory/${groupKey}/Female/items`).once("value"),
    db.ref(`sites/${site}/groupInventory/${groupKey}/Male/items`).once("value")
  ]).then(([femaleSnap, maleSnap]) => {
    const femaleItems = femaleSnap.exists() ? femaleSnap.val() : {};
    const maleItems = maleSnap.exists() ? maleSnap.val() : {};

    if (!Object.keys(femaleItems).length && !Object.keys(maleItems).length) {
      panel.innerHTML = `<p style="color:var(--muted);">No inventory items set up for ${groupName} yet. Ask your Super User to add items in the Pre-Event tab.</p>`;
      return;
    }

    const inputLabel = type === "addition" ? "Cases brought" : "Case count";

    function sectionRows(items, sex) {
      return Object.entries(items).map(([key, item]) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);">
          <div>
            <div style="font-weight:600;">${item.name}</div>
            <div style="color:var(--muted); font-size:0.75rem;">Par level: ${item.parLevel} cases</div>
          </div>
          <div style="text-align:right;">
            <label style="display:block; font-size:0.7rem; color:var(--muted);">${inputLabel}</label>
            <input type="number" class="count-input" data-sex="${sex}" data-key="${key}" data-name="${item.name}" step="0.25" min="0" placeholder="0.00"
              style="width:100px; padding:8px; border:1px solid var(--border); border-radius:6px; text-align:right;">
          </div>
        </div>
      `).join("");
    }

    panel.innerHTML = `
      <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">
        ${type === "addition"
          ? "Log how many cases of each item you brought/restocked (quarter-case increments, e.g. .25, .50, .75, 1.00...)."
          : `Enter ${type} case count for each item (in quarter-case increments, e.g. .25, .50, .75, 1.00, 1.25...).`}
      </p>
      ${Object.keys(femaleItems).length ? `<h4 style="color:var(--navy); margin-bottom:8px;">Female</h4>${sectionRows(femaleItems, "Female")}` : ""}
      ${Object.keys(maleItems).length ? `<h4 style="color:var(--navy); margin:16px 0 8px;">Male</h4>${sectionRows(maleItems, "Male")}` : ""}
      <button id="submit-count-btn" style="margin-top:16px; padding:10px 20px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">
        Submit
      </button>
      <div id="count-submit-status" style="margin-top:12px; font-size:0.85rem;"></div>
    `;

    document.getElementById("submit-count-btn").addEventListener("click", () => {
      const statusEl = document.getElementById("count-submit-status");
      const countsBySex = { Female: {}, Male: {} };
      let hasAny = false;
      panel.querySelectorAll(".count-input").forEach((input) => {
        const val = input.value.trim();
        if (val !== "") {
          countsBySex[input.dataset.sex][input.dataset.key] = { name: input.dataset.name, count: parseFloat(val) };
          hasAny = true;
        }
      });

      if (!hasAny) {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Enter at least one count before submitting.";
        return;
      }

      const writes = [];
      ["Female", "Male"].forEach((sex) => {
        if (Object.keys(countsBySex[sex]).length) {
          writes.push(db.ref(`sites/${site}/groupInventory/${groupKey}/${sex}/counts`).push({
            type,
            countedByUid: currentUser.uid,
            countedByName: `${currentUser.firstName} ${currentUser.lastName}`,
            countedByRole: getUserRoleKeys(currentUser).join(","),
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            counts: countsBySex[sex]
          }));
        }
      });

      Promise.all(writes).then(() => {
        statusEl.style.color = "var(--success)";
        statusEl.textContent = "Submitted.";
      }).catch((err) => {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Failed to submit: " + err.message;
      });
    });
  });
}

// ===================== CLOSING: INVENTORY COUNT HISTORY (Superadmin/Super User) =====================
function renderInventoryCountHistory(content) {
  const topSelector = document.getElementById("site-selector");
  const site = hasRole(currentUser, "superadmin") ? topSelector.value : currentUser.site;

  if (hasRole(currentUser, "superadmin") && site === "all") {
    content.innerHTML = `<div class="panel-placeholder">Pick a specific site above to view its inventory count history.</div>`;
    return;
  }

  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading location groups...</p></div>`;

  getLocationGroups(site).then((groups) => {
    const groupKeys = Object.keys(groups);
    if (!groupKeys.length) {
      content.innerHTML = `<div class="panel-placeholder">No units imported for ${SITES[site]} yet.</div>`;
      return;
    }
    const groupOptions = groupKeys.map(key => `<option value="${key}">${groups[key].name}</option>`).join("");

    content.innerHTML = `
      <div class="card">
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Location group</label>
        <select id="history-group-select" style="width:100%; max-width:300px; padding:8px; border:1px solid var(--border); border-radius:6px;">
          ${groupOptions}
        </select>
      </div>
      <div id="history-group-content"></div>
    `;

    const groupSelect = document.getElementById("history-group-select");
    groupSelect.addEventListener("change", () => renderGroupCountHistory(site, groupSelect.value, groups[groupSelect.value].name));
    renderGroupCountHistory(site, groupSelect.value, groups[groupSelect.value].name);
  });
}

const COUNT_TYPE_LABELS = {
  beginning: { label: "Beginning count", bg: "#dce8f5", color: "#2c5f8a" },
  addition: { label: "Addition / restock", bg: "#f0dcd8", color: "#a13f30" },
  ending: { label: "Ending count", bg: "#e2ede0", color: "#3a7d44" }
};

function renderGroupCountHistory(site, groupKey, groupName) {
  const panel = document.getElementById("history-group-content");
  panel.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading...</p></div>`;

  Promise.all([
    db.ref(`sites/${site}/groupInventory/${groupKey}/Female/items`).once("value"),
    db.ref(`sites/${site}/groupInventory/${groupKey}/Female/counts`).once("value"),
    db.ref(`sites/${site}/groupInventory/${groupKey}/Male/items`).once("value"),
    db.ref(`sites/${site}/groupInventory/${groupKey}/Male/counts`).once("value")
  ]).then(([femaleItemsSnap, femaleCountsSnap, maleItemsSnap, maleCountsSnap]) => {
    function buildSummary(itemsSnap, countsSnap) {
      const items = itemsSnap.exists() ? itemsSnap.val() : {};
      const entries = [];
      if (countsSnap.exists()) countsSnap.forEach((child) => entries.push(child.val()));

      const latest = {};
      Object.keys(items).forEach((key) => { latest[key] = { beginning: null, additionSum: 0, ending: null }; });
      entries.forEach((entry) => {
        Object.entries(entry.counts || {}).forEach(([key, c]) => {
          if (!latest[key]) latest[key] = { beginning: null, additionSum: 0, ending: null };
          if (entry.type === "beginning") latest[key].beginning = c.count;
          if (entry.type === "addition") latest[key].additionSum += c.count;
          if (entry.type === "ending") latest[key].ending = c.count;
        });
      });

      const summaryRows = Object.entries(items).map(([key, item]) => {
        const l = latest[key] || { beginning: null, additionSum: 0, ending: null };
        const orderQty = l.ending !== null ? Math.max(0, item.parLevel - l.ending) : null;
        return `
          <tr>
            <td style="padding:8px; border-bottom:1px solid var(--border);">${item.name}</td>
            <td style="padding:8px; border-bottom:1px solid var(--border);">${item.parLevel}</td>
            <td style="padding:8px; border-bottom:1px solid var(--border);">${l.beginning ?? "—"}</td>
            <td style="padding:8px; border-bottom:1px solid var(--border);">${l.additionSum || "—"}</td>
            <td style="padding:8px; border-bottom:1px solid var(--border);">${l.ending ?? "—"}</td>
            <td style="padding:8px; border-bottom:1px solid var(--border); font-weight:600; ${orderQty > 0 ? "color:var(--danger);" : ""}">${orderQty !== null ? orderQty : "—"}</td>
          </tr>
        `;
      }).join("");

      return { summaryRows, entries, hasItems: Object.keys(items).length > 0 };
    }

    const female = buildSummary(femaleItemsSnap, femaleCountsSnap);
    const male = buildSummary(maleItemsSnap, maleCountsSnap);

    function summaryTable(label, result) {
      if (!result.hasItems) return "";
      return `
        <div class="card">
          <h3 style="color:var(--navy); margin-bottom:14px;">${groupName} — ${label} — Current Status</h3>
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            <thead>
              <tr style="text-align:left; color:var(--muted);">
                <th style="padding:8px; border-bottom:2px solid var(--border);">Item</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Par</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Beginning</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Additions</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Ending</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Order Qty</th>
              </tr>
            </thead>
            <tbody>${result.summaryRows}</tbody>
          </table>
        </div>
      `;
    }

    const combinedEntries = [
      ...female.entries.map(e => ({ ...e, sex: "Female" })),
      ...male.entries.map(e => ({ ...e, sex: "Male" }))
    ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const historyHtml = combinedEntries.map(entry => {
      const when = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—";
      const typeInfo = COUNT_TYPE_LABELS[entry.type] || { label: entry.type, bg: "#eee", color: "#666" };
      const itemRows = Object.entries(entry.counts || {}).map(([key, c]) =>
        `<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:0.85rem;">
          <span>${c.name}</span><span>${c.count}</span>
        </div>`
      ).join("");

      return `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <div style="font-weight:600; margin-bottom:4px;">${entry.countedByName} — ${entry.sex}</div>
            <span style="font-size:0.75rem; padding:2px 8px; border-radius:10px; background:${typeInfo.bg}; color:${typeInfo.color};">${typeInfo.label}</span>
          </div>
          <div style="color:var(--muted); font-size:0.75rem; margin-bottom:10px;">${when}</div>
          ${itemRows}
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      ${summaryTable("Female", female)}
      ${summaryTable("Male", male)}
      ${!female.hasItems && !male.hasItems ? `<div class="panel-placeholder">No items set up yet for ${groupName}.</div>` : ""}
      <h4 style="color:var(--navy); margin:16px 0 10px;">History</h4>
      ${historyHtml || `<p style="color:var(--muted);">No counts logged yet for ${groupName}.</p>`}
    `;
  });
}

// ===================== USER: REQUEST SUPPLIES (mid-event, goes to Maintenance) =====================
function renderSupplyRequestForm(content) {
  const site = currentUser.site;
  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading...</p></div>`;

  Promise.all([getLocationGroups(site), getAssignedGroupKeys(site, currentUser.uid)]).then(([allGroups, assignedKeys]) => {
    const groups = Object.fromEntries(Object.entries(allGroups).filter(([key]) => assignedKeys.has(key)));
    const groupKeys = Object.keys(groups);
    if (!groupKeys.length) {
      content.innerHTML = `<div class="panel-placeholder">No units are currently assigned to you. Ask your Super User to assign you a unit in the Pre-Event tab.</div>`;
      return;
    }
    const groupOptions = groupKeys.map(key => `<option value="${key}">${groups[key].name}</option>`).join("");

    content.innerHTML = `
      <div class="card">
        <h3 style="color:var(--navy); margin-bottom:14px;">Request Supplies — ${SITES[site]}</h3>
        <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">Running low on something mid-event? This alerts Maintenance to bring more.</p>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Location group</label>
        <select id="request-group-select" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px; margin-bottom:14px;">
          ${groupOptions}
        </select>
        <div id="request-items-content"></div>
      </div>
    `;

    const groupSelect = document.getElementById("request-group-select");
    groupSelect.addEventListener("change", () => renderRequestItemPicker(site, groupSelect.value, groups[groupSelect.value].name));
    renderRequestItemPicker(site, groupSelect.value, groups[groupSelect.value].name);
  });
}

function renderRequestItemPicker(site, groupKey, groupName) {
  const panel = document.getElementById("request-items-content");
  panel.innerHTML = `<p style="color:var(--muted);">Loading items...</p>`;

  Promise.all([
    db.ref(`sites/${site}/groupInventory/${groupKey}/Female/items`).once("value"),
    db.ref(`sites/${site}/groupInventory/${groupKey}/Male/items`).once("value")
  ]).then(([femaleSnap, maleSnap]) => {
    const femaleItems = femaleSnap.exists() ? femaleSnap.val() : {};
    const maleItems = maleSnap.exists() ? maleSnap.val() : {};

    if (!Object.keys(femaleItems).length && !Object.keys(maleItems).length) {
      panel.innerHTML = `<p style="color:var(--muted);">No inventory items set up for ${groupName} yet.</p>`;
      return;
    }

    const itemOptions = [
      ...Object.entries(femaleItems).map(([key, item]) => `<option value="Female:${key}">${item.name} (Female)</option>`),
      ...Object.entries(maleItems).map(([key, item]) => `<option value="Male:${key}">${item.name} (Male)</option>`)
    ].join("");

    panel.innerHTML = `
      <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Item</label>
      <select id="request-item-select" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px; margin-bottom:14px;">
        ${itemOptions}
      </select>
      <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Note (optional)</label>
      <textarea id="request-note-input" rows="2" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px; margin-bottom:14px; font-family:inherit;" placeholder="e.g. completely out, need it soon"></textarea>
      <button id="submit-request-btn" style="padding:10px 20px; background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600;">
        Send Request to Maintenance
      </button>
      <div id="request-submit-status" style="margin-top:12px; font-size:0.85rem;"></div>
    `;

    document.getElementById("submit-request-btn").addEventListener("click", () => {
      const [sex, itemKey] = document.getElementById("request-item-select").value.split(":");
      const itemName = (sex === "Female" ? femaleItems : maleItems)[itemKey].name;
      const note = document.getElementById("request-note-input").value.trim();
      const statusEl = document.getElementById("request-submit-status");

      db.ref(`sites/${site}/supplyRequests`).push({
        groupKey, groupName, sex, itemKey, itemName, note,
        requestedByUid: currentUser.uid,
        requestedByName: `${currentUser.firstName} ${currentUser.lastName}`,
        requestedAt: firebase.database.ServerValue.TIMESTAMP,
        status: "open"
      }).then(() => {
        // Flag the item so admins see a "consider raising par" suggestion
        return db.ref(`sites/${site}/groupInventory/${groupKey}/${sex}/items/${itemKey}/parRaisedSuggested`).set(true);
      }).then(() => {
        statusEl.style.color = "var(--success)";
        statusEl.textContent = `Request sent — Maintenance has been notified about ${itemName} (${sex}) at ${groupName}.`;
        document.getElementById("request-note-input").value = "";
      }).catch((err) => {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Failed to send request: " + err.message;
      });
    });
  });
}

// ===================== INVENTORY ROLE: ORDERS DASHBOARD =====================
function renderInventoryOrders(content) {
  const site = currentUser.site;
  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading orders...</p></div>`;

  Promise.all([
    getLocationGroups(site),
    db.ref(`sites/${site}/supplyRequests`).orderByChild("status").equalTo("open").once("value")
  ]).then(([groups, requestsSnap]) => {
    const openRequests = [];
    if (requestsSnap.exists()) requestsSnap.forEach((child) => openRequests.push({ reqId: child.key, ...child.val() }));

    const groupKeys = Object.keys(groups);
    const groupFetches = groupKeys.map(key =>
      Promise.all([
        db.ref(`sites/${site}/groupInventory/${key}/Female/items`).once("value"),
        db.ref(`sites/${site}/groupInventory/${key}/Female/counts`).once("value"),
        db.ref(`sites/${site}/groupInventory/${key}/Male/items`).once("value"),
        db.ref(`sites/${site}/groupInventory/${key}/Male/counts`).once("value")
      ]).then(([femaleItemsSnap, femaleCountsSnap, maleItemsSnap, maleCountsSnap]) =>
        ({ key, name: groups[key].name, femaleItemsSnap, femaleCountsSnap, maleItemsSnap, maleCountsSnap })
      )
    );

    Promise.all(groupFetches).then((groupResults) => {
      const orderRows = [];

      function collectOrders(groupKey, groupName, sex, itemsSnap, countsSnap) {
        if (!itemsSnap.exists()) return;
        const items = itemsSnap.val();
        const latestEnding = {};
        if (countsSnap.exists()) {
          countsSnap.forEach((child) => {
            const entry = child.val();
            if (entry.type === "ending") {
              Object.entries(entry.counts || {}).forEach(([itemKey, c]) => { latestEnding[itemKey] = c.count; });
            }
          });
        }
        Object.entries(items).forEach(([itemKey, item]) => {
          const ending = latestEnding[itemKey];
          const orderQty = ending !== undefined ? Math.max(0, item.parLevel - ending) : null;
          if (orderQty !== null && orderQty > 0) {
            orderRows.push({ groupKey, groupName, sex, itemKey, itemName: item.name, parLevel: item.parLevel, ending, orderQty });
          }
        });
      }

      groupResults.forEach(({ key, name, femaleItemsSnap, femaleCountsSnap, maleItemsSnap, maleCountsSnap }) => {
        collectOrders(key, name, "Female", femaleItemsSnap, femaleCountsSnap);
        collectOrders(key, name, "Male", maleItemsSnap, maleCountsSnap);
      });

      const requestsHtml = openRequests.length ? `
        <div class="card">
          <h3 style="color:var(--navy); margin-bottom:14px;">Open Mid-Event Requests</h3>
          ${openRequests.map(r => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
              <div>
                <strong>${r.itemName}</strong> — ${r.groupName} (${r.sex})
                <div style="color:var(--muted); font-size:0.75rem;">Requested by ${r.requestedByName}${r.note ? ": " + r.note : ""}</div>
              </div>
              <button class="fulfill-request-btn" data-req-id="${r.reqId}" style="padding:6px 12px; background:var(--success); color:white; border:none; border-radius:6px; cursor:pointer; font-size:0.8rem;">Mark Fulfilled</button>
            </div>
          `).join("")}
        </div>
      ` : "";

      const ordersHtml = orderRows.length ? `
        <div class="card">
          <h3 style="color:var(--navy); margin-bottom:14px;">Reorder List — ${SITES[site]}</h3>
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            <thead>
              <tr style="text-align:left; color:var(--muted);">
                <th style="padding:8px; border-bottom:2px solid var(--border);">Location Group</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Sex</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Item</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Par</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Ending</th>
                <th style="padding:8px; border-bottom:2px solid var(--border);">Order Qty</th>
              </tr>
            </thead>
            <tbody>
              ${orderRows.map(r => `
                <tr>
                  <td style="padding:8px; border-bottom:1px solid var(--border);">${r.groupName}</td>
                  <td style="padding:8px; border-bottom:1px solid var(--border);">${r.sex}</td>
                  <td style="padding:8px; border-bottom:1px solid var(--border);">${r.itemName}</td>
                  <td style="padding:8px; border-bottom:1px solid var(--border);">${r.parLevel}</td>
                  <td style="padding:8px; border-bottom:1px solid var(--border);">${r.ending}</td>
                  <td style="padding:8px; border-bottom:1px solid var(--border); font-weight:600; color:var(--danger);">${r.orderQty}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <button id="email-order-btn" style="margin-top:14px; padding:10px 20px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">
            Email This Order
          </button>
        </div>
      ` : `<div class="panel-placeholder">No items currently below par for ${SITES[site]}.</div>`;

      content.innerHTML = requestsHtml + ordersHtml;

      content.querySelectorAll(".fulfill-request-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const req = openRequests.find(r => r.reqId === btn.dataset.reqId);
          const qtyStr = prompt(`How many cases of "${req.itemName}" (${req.sex}) were delivered to ${req.groupName}?`, "1");
          if (qtyStr === null) return; // cancelled
          const qty = parseFloat(qtyStr);
          if (isNaN(qty) || qty <= 0) {
            alert("Enter a valid quantity greater than 0.");
            return;
          }

          db.ref(`sites/${site}/groupInventory/${req.groupKey}/${req.sex}/counts`).push({
            type: "addition",
            countedByUid: currentUser.uid,
            countedByName: `${currentUser.firstName} ${currentUser.lastName}`,
            countedByRole: getUserRoleKeys(currentUser).join(","),
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            counts: { [req.itemKey]: { name: req.itemName, count: qty } },
            note: `Fulfilled mid-event request from ${req.requestedByName}`
          }).then(() => db.ref(`sites/${site}/supplyRequests/${btn.dataset.reqId}`).update({
            status: "fulfilled",
            fulfilledByUid: currentUser.uid,
            fulfilledByName: `${currentUser.firstName} ${currentUser.lastName}`,
            fulfilledAt: firebase.database.ServerValue.TIMESTAMP,
            fulfilledQty: qty
          })).then(() => renderInventoryOrders(content))
          .catch((err) => alert("Failed to mark fulfilled: " + err.message));
        });
      });

      const emailBtn = document.getElementById("email-order-btn");
      if (emailBtn) {
        emailBtn.addEventListener("click", () => {
          const bodyLines = orderRows.map(r => `${r.groupName} (${r.sex}) — ${r.itemName}: order ${r.orderQty} cases (par ${r.parLevel}, ending ${r.ending})`);
          const subject = encodeURIComponent(`Privy Check Order — ${SITES[site]}`);
          const body = encodeURIComponent(`Order needed for ${SITES[site]}:\n\n${bodyLines.join("\n")}`);
          window.location.href = `mailto:?subject=${subject}&body=${body}`;
        });
      }
    });
  });
}

// ===================== ADMIN PANEL: UNITS CSV IMPORT =====================
function renderAdminPanel(content) {
  const isSuperadmin = hasRole(currentUser, "superadmin");
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
      <h3 style="color:var(--navy); margin-bottom:14px;">Add Staff Member</h3>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:4px;">First Name</label>
          <input type="text" id="add-staff-first" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px;">
        </div>
        <div>
          <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Last Name</label>
          <input type="text" id="add-staff-last" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px;">
        </div>
        <div>
          <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Email</label>
          <input type="email" id="add-staff-email" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px;">
        </div>
        <div>
          <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Phone (optional)</label>
          <input type="tel" id="add-staff-phone" placeholder="717-555-0100" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px;">
        </div>
        <div>
          <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Roles (select one or more)</label>
          <div id="add-staff-role-checkboxes" style="padding:8px; border:1px solid var(--border); border-radius:6px;">
            ${(isSuperadmin
              ? ["superadmin", "superuser", "user", "maintenance", "preevent"]
              : ["user", "maintenance", "preevent", "superuser"]
            ).map((r, i) => `
              <label style="display:inline-block; margin:2px 10px 2px 0; font-size:0.85rem; cursor:pointer;">
                <input type="checkbox" class="add-staff-role-checkbox" value="${r}" ${r === "user" ? "checked" : ""}> ${ROLES[r].label}
              </label>
            `).join("")}
          </div>
        </div>
        <div>
          <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Site</label>
          <select id="add-staff-site" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px;" ${isSuperadmin ? "" : "disabled"}>
            ${isSuperadmin
              ? `<option value="all">All Sites</option>` + Object.entries(SITES).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")
              : `<option value="${currentUser.site}">${SITES[currentUser.site]}</option>`}
          </select>
        </div>
      </div>
      <button id="add-staff-btn" style="padding:10px 20px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">
        Add Staff Member
      </button>
      <div id="add-staff-status" style="margin-top:12px; font-size:0.85rem;"></div>
    </div>
    <div class="card">
      <h3 style="color:var(--navy); margin-bottom:14px;">Import Order Guide (XLSX)</h3>
      <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">
        Upload a spreadsheet in the standard Order Guide format (one sheet per location, "Womens"/"Mens" sections listing item name and Par). You'll map each sheet to an existing location group before anything is saved — sheet names don't have to match exactly.
      </p>
      <input type="file" id="order-guide-file-input" accept=".xlsx,.xls" style="margin-bottom:14px;">
      <br>
      <button id="order-guide-parse-btn" style="padding:10px 18px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">
        Parse File
      </button>
      <div id="order-guide-status" style="margin-top:12px; font-size:0.85rem;"></div>
      <div id="order-guide-mapping-content"></div>
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
        Role must be superadmin / superuser / user / maintenance / preevent / executive / inventory — a person can hold more than one, separated by commas (e.g. "user,preevent"). Site can be blank if every role is superadmin/executive (defaults to "all").
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

  // ---------- Add Staff Member (single-record quick add) ----------
  const addSiteSelect = document.getElementById("add-staff-site");
  const addRoleCheckboxes = () => Array.from(document.querySelectorAll(".add-staff-role-checkbox"));

  if (isSuperadmin) {
    addRoleCheckboxes().forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = addRoleCheckboxes().filter(c => c.checked).map(c => c.value);
        const allOrgWide = checked.length && checked.every(r => r === "superadmin" || r === "executive");
        if (allOrgWide) {
          addSiteSelect.value = "all";
          addSiteSelect.disabled = true;
        } else {
          addSiteSelect.disabled = false;
        }
      });
    });
  }

  document.getElementById("add-staff-btn").addEventListener("click", () => {
    const statusEl = document.getElementById("add-staff-status");
    const firstName = document.getElementById("add-staff-first").value.trim();
    const lastName = document.getElementById("add-staff-last").value.trim();
    const email = document.getElementById("add-staff-email").value.trim();
    const phone = document.getElementById("add-staff-phone").value.trim();
    const checkedRoles = addRoleCheckboxes().filter(c => c.checked).map(c => c.value);

    if (!firstName || !lastName) {
      statusEl.style.color = "var(--danger)";
      statusEl.textContent = "First and last name are required.";
      return;
    }
    if (!checkedRoles.length) {
      statusEl.style.color = "var(--danger)";
      statusEl.textContent = "Select at least one role.";
      return;
    }

    const roles = {};
    checkedRoles.forEach(r => { roles[r] = true; });
    const allOrgWide = checkedRoles.every(r => r === "superadmin" || r === "executive");
    const site = allOrgWide ? "all" : addSiteSelect.value;

    statusEl.style.color = "var(--muted)";
    statusEl.textContent = "Adding...";

    db.ref("users").once("value").then((usersSnap) => {
      const usedPins = new Set();
      usersSnap.forEach((child) => { if (child.val().pin) usedPins.add(child.val().pin); });

      let newPin, attempts = 0;
      do {
        newPin = String(Math.floor(1000 + Math.random() * 9000));
        attempts++;
      } while (usedPins.has(newPin) && attempts < 100);

      const newUserRef = db.ref("users").push();
      newUserRef.set({ firstName, lastName, email, phone, roles, site, pin: newPin, active: true })
        .then(() => {
          statusEl.style.color = "var(--success)";
          statusEl.textContent = `Added ${firstName} ${lastName} — PIN ${newPin} (${checkedRoles.map(r => ROLES[r].label).join(", ")}${site !== "all" ? ", " + SITES[site] : ""})`;
          document.getElementById("add-staff-first").value = "";
          document.getElementById("add-staff-last").value = "";
          document.getElementById("add-staff-email").value = "";
          document.getElementById("add-staff-phone").value = "";
          loadStaffTable(document.getElementById("admin-site-select").value);
        })
        .catch((err) => {
          statusEl.style.color = "var(--danger)";
          statusEl.textContent = "Failed to add: " + err.message;
        });
    });
  });

  document.getElementById("order-guide-parse-btn").addEventListener("click", () => {
    const fileInput = document.getElementById("order-guide-file-input");
    const statusEl = document.getElementById("order-guide-status");
    const site = siteSelect.value;

    if (!fileInput.files.length) {
      statusEl.style.color = "var(--danger)";
      statusEl.textContent = "Choose an XLSX file first.";
      return;
    }

    statusEl.style.color = "var(--muted)";
    statusEl.textContent = "Parsing...";

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: "array" });
        const parsedSheets = workbook.SheetNames.map((sheetName) => {
          const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
          return { sheetName, items: parseOrderGuideSheet(grid) };
        }).filter(s => s.items.Female.length || s.items.Male.length);

        if (!parsedSheets.length) {
          statusEl.style.color = "var(--danger)";
          statusEl.textContent = "Couldn't find any 'Womens'/'Mens' sections in this file. Check the format.";
          return;
        }

        statusEl.style.color = "var(--success)";
        statusEl.textContent = `Parsed ${parsedSheets.length} sheet(s). Map each to a location group below, then import.`;
        renderOrderGuideMapping(site, parsedSheets);
      } catch (err) {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Failed to parse file: " + err.message;
      }
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
  });

  document.getElementById("csv-template-btn").addEventListener("click", () => {
    const site = siteSelect.value;
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
    const VALID_ROLES = ["superadmin", "superuser", "user", "maintenance", "preevent", "executive", "inventory"];

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
            const roleField = (row.role || "").trim().toLowerCase();
            const roleList = roleField.split(",").map(r => r.trim()).filter(Boolean);
            let site = (row.site || "").trim().toLowerCase();
            let pin = (row.pin || "").trim();

            if (!firstName || !lastName) { errors.push(`Row ${i + 2}: missing first/last name`); return; }
            if (!roleList.length) { errors.push(`Row ${i + 2}: role is required`); return; }
            const badRoles = roleList.filter(r => !VALID_ROLES.includes(r));
            if (badRoles.length) { errors.push(`Row ${i + 2}: role "${badRoles.join(", ")}" must be superadmin, superuser, user, maintenance, preevent, executive, or inventory`); return; }
            const allOrgWide = roleList.every(r => r === "superadmin" || r === "executive");
            if (allOrgWide) {
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

            const roles = {};
            roleList.forEach(r => { roles[r] = true; });
            const uidKey = `staff_${Date.now()}_${i}`;
            newUsers[uidKey] = { firstName, lastName, email, phone, roles, site, pin, active: true };
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
                .map(([, u]) => `${u.firstName} ${u.lastName} — PIN ${u.pin} (${formatRoleLabels(u)}${u.site !== "all" ? ", " + SITES[u.site] : ""})`)
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

// ===================== ORDER GUIDE XLSX IMPORT: PARSING =====================
// Reads one sheet's raw grid (array of arrays) and pulls out item name + par
// level for the "Womens" and "Mens" sections. Ignores the unit column and all
// the weekend Beginning/Additions/Ending/Usage columns — those are historical
// scratch data in the workbook, not something we need to import.
function parseOrderGuideSheet(grid) {
  const result = { Female: [], Male: [] };
  let currentSection = null; // "Female" | "Male" | null

  for (const row of grid) {
    const cellA = row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : "";
    const cellB = row[1] !== undefined && row[1] !== null ? String(row[1]).trim() : "";
    const cellC = row[2];

    if (/^womens?$/i.test(cellA)) { currentSection = "Female"; continue; }
    if (/^mens?$/i.test(cellA)) { currentSection = "Male"; continue; }

    if (!currentSection) continue;
    if (!cellA) continue; // blank name row — end of this section's items, or stray totals row
    if (typeof cellC !== "number") continue; // par must be a real number

    result[currentSection].push({ name: cellA, unit: cellB, parLevel: cellC });
  }

  return result;
}

// ===================== ORDER GUIDE XLSX IMPORT: MAPPING UI =====================
function renderOrderGuideMapping(site, parsedSheets) {
  const container = document.getElementById("order-guide-mapping-content");
  container.innerHTML = `<p style="color:var(--muted); margin-top:14px;">Loading location groups...</p>`;

  getLocationGroups(site).then((groups) => {
    const groupKeys = Object.keys(groups);
    if (!groupKeys.length) {
      container.innerHTML = `<div class="panel-placeholder" style="margin-top:14px;">No location groups exist yet for ${SITES[site]} — import units first.</div>`;
      return;
    }
    const groupOptionsHtml = (selectedGuess) => groupKeys.map(key => {
      const selected = key === selectedGuess ? "selected" : "";
      return `<option value="${key}" ${selected}>${groups[key].name}</option>`;
    }).join("") + `<option value="__skip__">— Skip this sheet —</option>`;

    // Best-effort guess: match sheet name to a group name, tolerant of minor spelling differences
    function guessGroup(sheetName) {
      const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const target = normalize(sheetName);
      let best = null, bestScore = 0;
      groupKeys.forEach((key) => {
        const candidate = normalize(groups[key].name);
        let score = 0;
        const minLen = Math.min(target.length, candidate.length);
        for (let i = 0; i < minLen; i++) if (target[i] === candidate[i]) score++;
        if (target === candidate) score += 100;
        if (score > bestScore) { bestScore = score; best = key; }
      });
      return best;
    }

    const rowsHtml = parsedSheets.map((sheet, i) => {
      const guess = guessGroup(sheet.sheetName);
      return `
        <div class="card" style="margin-top:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div>
              <strong>${sheet.sheetName}</strong>
              <div style="color:var(--muted); font-size:0.8rem;">
                ${sheet.items.Female.length} Female item(s), ${sheet.items.Male.length} Male item(s) found
              </div>
            </div>
            <div>
              <label style="display:block; font-size:0.75rem; color:var(--muted); margin-bottom:4px;">Maps to</label>
              <select class="order-guide-group-select" data-sheet-index="${i}" style="padding:6px; border:1px solid var(--border); border-radius:6px;">
                ${groupOptionsHtml(guess)}
              </select>
            </div>
          </div>
          <details>
            <summary style="cursor:pointer; color:var(--muted); font-size:0.8rem;">Preview items</summary>
            <div style="margin-top:8px; font-size:0.85rem;">
              ${sheet.items.Female.length ? `<div style="font-weight:600; margin-top:6px;">Female</div>` + sheet.items.Female.map(it => `<div>${it.name} — par ${it.parLevel}</div>`).join("") : ""}
              ${sheet.items.Male.length ? `<div style="font-weight:600; margin-top:6px;">Male</div>` + sheet.items.Male.map(it => `<div>${it.name} — par ${it.parLevel}</div>`).join("") : ""}
            </div>
          </details>
        </div>
      `;
    }).join("");

    container.innerHTML = `
      ${rowsHtml}
      <p style="color:var(--muted); font-size:0.85rem; margin-top:14px;">
        Importing <strong>replaces</strong> the Female/Male item lists for each mapped group with what's parsed here.
      </p>
      <button id="order-guide-commit-btn" style="margin-top:8px; padding:10px 20px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">
        Import Mapped Sheets
      </button>
      <div id="order-guide-commit-status" style="margin-top:12px; font-size:0.85rem;"></div>
    `;

    document.getElementById("order-guide-commit-btn").addEventListener("click", () => {
      const statusEl = document.getElementById("order-guide-commit-status");
      const mappings = [];
      container.querySelectorAll(".order-guide-group-select").forEach((select) => {
        const idx = parseInt(select.dataset.sheetIndex, 10);
        if (select.value !== "__skip__") mappings.push({ groupKey: select.value, sheet: parsedSheets[idx] });
      });

      if (!mappings.length) {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Nothing mapped — every sheet is set to skip.";
        return;
      }

      if (!confirm(`Import ${mappings.length} sheet(s)? This replaces the current Female/Male item lists for each mapped group.`)) return;

      statusEl.style.color = "var(--muted)";
      statusEl.textContent = "Importing...";

      const writes = [];
      mappings.forEach(({ groupKey, sheet }) => {
        ["Female", "Male"].forEach((sex) => {
          if (!sheet.items[sex].length) return;
          const itemsObj = {};
          sheet.items[sex].forEach((it) => {
            const key = it.name.replace(/[.#$/\[\]]/g, "_");
            itemsObj[key] = { name: it.name, parLevel: it.parLevel };
          });
          writes.push(db.ref(`sites/${site}/groupInventory/${groupKey}/${sex}/items`).set(itemsObj));
        });
      });

      Promise.all(writes).then(() => {
        statusEl.style.color = "var(--success)";
        statusEl.textContent = `Imported ${mappings.length} sheet(s) successfully.`;
      }).catch((err) => {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Import failed: " + err.message;
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
  }).catch((err) => {
    label.textContent = "Error loading: " + err.message + " (check database rules include 'settings')";
    label.style.color = "var(--danger)";
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
    }    const entries = [];
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
  }).catch((err) => {
    container.innerHTML = `<p style='color:var(--danger); font-size:0.85rem;'>Error loading: ${err.message} (check database rules include 'smsLog')</p>`;
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
      if (u.site === site || ((hasRole(u, "superadmin") || hasRole(u, "executive")) && hasRole(currentUser, "superadmin"))) {
        relevantUsers.push({ uid: child.key, ...u });
      }
    });

    if (!relevantUsers.length) {
      container.innerHTML = "<p style='color:var(--muted);'>No staff for this site yet.</p>";
      return;
    }

    const isSuperadminViewer = hasRole(currentUser, "superadmin");

    const rows = relevantUsers.map(u => {
      const modCell = (hasRole(u, "superuser") || hasRole(u, "maintenance"))
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
      const userRoleKeys = getUserRoleKeys(u);
      const canEditThisRole = isSuperadminViewer || (hasRole(currentUser, "superuser") && userRoleKeys.every(r => ["user", "maintenance", "preevent", "superuser"].includes(r)));
      const editableRoleOptions = isSuperadminViewer
        ? Object.keys(ROLES).filter(r => r !== "executive" && r !== "inventory")
        : ["user", "maintenance", "preevent", "superuser"];
      const roleCell = canEditThisRole
        ? `<details class="role-edit-details" data-uid="${u.uid}">
            <summary style="cursor:pointer; padding:4px 8px; border:1px solid var(--border); border-radius:4px; display:inline-block; font-size:0.8rem;">${formatRoleLabels(u)} ▾</summary>
            <div style="margin-top:6px; padding:8px; border:1px solid var(--border); border-radius:6px; background:#fafafa;">
              ${editableRoleOptions.map(r => `
                <label style="display:block; font-size:0.8rem; margin-bottom:4px; cursor:pointer;">
                  <input type="checkbox" class="role-checkbox" value="${r}" ${userRoleKeys.includes(r) ? "checked" : ""}> ${ROLES[r].label}
                </label>
              `).join("")}
              <button class="role-save-btn" data-uid="${u.uid}" style="margin-top:6px; padding:4px 10px; font-size:0.75rem; background:var(--navy); color:white; border:none; border-radius:4px; cursor:pointer;">Save Roles</button>
            </div>
          </details>`
        : formatRoleLabels(u);
      return `<tr>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${u.firstName} ${u.lastName}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border);">${roleCell}</td>
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

    container.querySelectorAll(".role-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.dataset.uid;
        const details = container.querySelector(`.role-edit-details[data-uid="${uid}"]`);
        const checked = Array.from(details.querySelectorAll(".role-checkbox:checked")).map(cb => cb.value);

        if (!checked.length) {
          alert("Select at least one role.");
          return;
        }

        const newRoles = {};
        checked.forEach(r => { newRoles[r] = true; });

        const updates = { roles: newRoles, role: null }; // clear legacy single-role field
        // If every selected role is org-wide (superadmin/executive), lock site to "all".
        // Otherwise, a site-scoped role needs a real site — keep existing if already
        // set to a real site, or default to the currently-viewed site.
        const allOrgWide = checked.every(r => r === "superadmin" || r === "executive");
        if (allOrgWide) {
          updates.site = "all";
        } else {
          const user = relevantUsers.find(u => u.uid === uid);
          if (!user.site || user.site === "all") updates.site = site;
        }

        db.ref(`users/${uid}`).update(updates)
          .then(() => loadStaffTable(site))
          .catch((err) => alert("Failed to update roles: " + err.message));
      });
    });

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
