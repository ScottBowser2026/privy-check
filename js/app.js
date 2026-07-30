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
      { id: "out-of-order", label: "Flag a Unit" },
      { id: "request-supplies", label: "Request Supplies" }
    ];
  } else if (role === "maintenance") {
    tabs = [
      { id: "out-of-order", label: "Flagged Units" },
      { id: "supplies", label: "Log Supplies" }
    ];
  } else if (role === "preevent") {
    tabs = [
      { id: "pre-event", label: "Pre-Event" }
    ];
  } else if (role === "executive") {
    tabs = [
      { id: "reports", label: "Reports" }
    ];
  } else if (role === "inventory") {
    tabs = [
      { id: "orders", label: "Orders" }
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

  if (tabId === "pre-event") {
    if (currentUser.role === "superadmin" || currentUser.role === "superuser") {
      renderInventoryItemsAdmin(content);
    } else if (currentUser.role === "user" || currentUser.role === "preevent") {
      renderInventoryCountEntry(content, "beginning", "Beginning Inventory Count");
    } else {
      content.innerHTML = `<div class="panel-placeholder"><h3 style="margin-bottom:8px;color:var(--navy)">Pre-Event Task List</h3><p>Checklist tasks coming in a future build pass.</p></div>`;
    }
    return;
  }

  if (tabId === "closing") {
    if (currentUser.role === "user") {
      renderInventoryCountEntry(content, "ending", "Ending Inventory Count");
    } else if (currentUser.role === "superadmin" || currentUser.role === "superuser") {
      renderInventoryCountHistory(content);
    } else {
      content.innerHTML = `<div class="panel-placeholder"><h3 style="margin-bottom:8px;color:var(--navy)">Closing Task List</h3><p>Checklist tasks coming in a future build pass.</p></div>`;
    }
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
      <h3 style="margin-bottom:8px;color:var(--navy)">${labels[tabId]}</h3>
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

// ===================== PRE-EVENT: INVENTORY ITEMS ADMIN (Superadmin/Super User) =====================
const SUGGESTED_INVENTORY_ITEMS = [
  "Toilet Paper", "Paper Towels", "Hand Soap", "Hand Sanitizer", "Trash Bags",
  "Toilet Seat Covers", "Air Freshener", "Disinfectant Spray", "Gloves", "Urinal Screens"
];

function renderInventoryItemsAdmin(content) {
  const topSelector = document.getElementById("site-selector");
  const site = currentUser.role === "superadmin" ? topSelector.value : currentUser.site;

  if (currentUser.role === "superadmin" && site === "all") {
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
          Inventory is tracked per location group — units sharing the same name (e.g. Male/Female/ADA at "King Loo") share one inventory pool.
        </p>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:6px;">Location group</label>
        <select id="inventory-group-select" style="width:100%; max-width:300px; padding:8px; border:1px solid var(--border); border-radius:6px; margin-bottom:16px;">
          ${groupOptions}
        </select>
        <div id="inventory-group-content"></div>
      </div>
    `;

    const groupSelect = document.getElementById("inventory-group-select");
    groupSelect.addEventListener("change", () => renderGroupItemsPanel(site, groupSelect.value, groups[groupSelect.value].name));
    renderGroupItemsPanel(site, groupSelect.value, groups[groupSelect.value].name);
  });
}

function renderGroupItemsPanel(site, groupKey, groupName) {
  const panel = document.getElementById("inventory-group-content");
  panel.innerHTML = `<p style="color:var(--muted);">Loading items...</p>`;

  db.ref(`sites/${site}/groupInventory/${groupKey}/items`).once("value").then((snap) => {
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

    function addItem(name, parLevel) {
      const statusEl = document.getElementById("item-add-status");
      if (!name.trim()) {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Item name is required.";
        return;
      }
      const key = name.trim().replace(/[.#$/\[\]]/g, "_");
      db.ref(`sites/${site}/groupInventory/${groupKey}/items/${key}`).set({ name: name.trim(), parLevel: parseFloat(parLevel) || 0 })
        .then(() => renderGroupItemsPanel(site, groupKey, groupName))
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
        db.ref(`sites/${site}/groupInventory/${groupKey}/items/${btn.dataset.key}`).remove()
          .then(() => renderGroupItemsPanel(site, groupKey, groupName))
          .catch((err) => alert("Failed to remove: " + err.message));
      });
    });
  });
}

// ===================== INVENTORY COUNT ENTRY (User closing count, or Maintenance supply restock) =====================
function renderInventoryCountEntry(content, type, title) {
  const site = currentUser.site;
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

  db.ref(`sites/${site}/groupInventory/${groupKey}/items`).once("value").then((snap) => {
    if (!snap.exists()) {
      panel.innerHTML = `<p style="color:var(--muted);">No inventory items set up for ${groupName} yet. Ask your Super User to add items in the Pre-Event tab.</p>`;
      return;
    }
    const items = snap.val();
    const inputLabel = type === "addition" ? "Cases brought" : "Case count";
    const rows = Object.entries(items).map(([key, item]) => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:600;">${item.name}</div>
          <div style="color:var(--muted); font-size:0.75rem;">Par level: ${item.parLevel} cases</div>
        </div>
        <div style="text-align:right;">
          <label style="display:block; font-size:0.7rem; color:var(--muted);">${inputLabel}</label>
          <input type="number" class="count-input" data-key="${key}" data-name="${item.name}" step="0.25" min="0" placeholder="0.00"
            style="width:100px; padding:8px; border:1px solid var(--border); border-radius:6px; text-align:right;">
        </div>
      </div>
    `).join("");

    panel.innerHTML = `
      <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">
        ${type === "addition"
          ? "Log how many cases of each item you brought/restocked (quarter-case increments, e.g. .25, .50, .75, 1.00...)."
          : `Enter ${type} case count for each item (in quarter-case increments, e.g. .25, .50, .75, 1.00, 1.25...).`}
      </p>
      ${rows}
      <button id="submit-count-btn" style="margin-top:16px; padding:10px 20px; background:var(--navy); color:white; border:none; border-radius:6px; cursor:pointer;">
        Submit
      </button>
      <div id="count-submit-status" style="margin-top:12px; font-size:0.85rem;"></div>
    `;

    document.getElementById("submit-count-btn").addEventListener("click", () => {
      const statusEl = document.getElementById("count-submit-status");
      const counts = {};
      let hasAny = false;
      panel.querySelectorAll(".count-input").forEach((input) => {
        const val = input.value.trim();
        if (val !== "") {
          counts[input.dataset.key] = { name: input.dataset.name, count: parseFloat(val) };
          hasAny = true;
        }
      });

      if (!hasAny) {
        statusEl.style.color = "var(--danger)";
        statusEl.textContent = "Enter at least one count before submitting.";
        return;
      }

      db.ref(`sites/${site}/groupInventory/${groupKey}/counts`).push({
        type,
        countedByUid: currentUser.uid,
        countedByName: `${currentUser.firstName} ${currentUser.lastName}`,
        countedByRole: currentUser.role,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        counts
      }).then(() => {
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
  const site = currentUser.role === "superadmin" ? topSelector.value : currentUser.site;

  if (currentUser.role === "superadmin" && site === "all") {
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
    db.ref(`sites/${site}/groupInventory/${groupKey}/items`).once("value"),
    db.ref(`sites/${site}/groupInventory/${groupKey}/counts`).once("value")
  ]).then(([itemsSnap, countsSnap]) => {
    const items = itemsSnap.exists() ? itemsSnap.val() : {};
    const entries = [];
    if (countsSnap.exists()) countsSnap.forEach((child) => entries.push(child.val()));

    // Compute latest count of each type, per item, for the reorder summary
    const latest = {}; // itemKey -> { beginning, addition (sum), ending }
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

    entries.reverse();
    const historyHtml = entries.map(entry => {
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
            <div style="font-weight:600; margin-bottom:4px;">${entry.countedByName}</div>
            <span style="font-size:0.75rem; padding:2px 8px; border-radius:10px; background:${typeInfo.bg}; color:${typeInfo.color};">${typeInfo.label}</span>
          </div>
          <div style="color:var(--muted); font-size:0.75rem; margin-bottom:10px;">${when}</div>
          ${itemRows}
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="card">
        <h3 style="color:var(--navy); margin-bottom:14px;">${groupName} — Current Status</h3>
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
          <tbody>${summaryRows || `<tr><td colspan="6" style="padding:8px; color:var(--muted);">No items set up yet.</td></tr>`}</tbody>
        </table>
      </div>
      <h4 style="color:var(--navy); margin:16px 0 10px;">History</h4>
      ${historyHtml || `<p style="color:var(--muted);">No counts logged yet for ${groupName}.</p>`}
    `;
  });
}

// ===================== USER: REQUEST SUPPLIES (mid-event, goes to Maintenance) =====================
function renderSupplyRequestForm(content) {
  const site = currentUser.site;
  content.innerHTML = `<div class="card"><p style="color:var(--muted);">Loading...</p></div>`;

  getLocationGroups(site).then((groups) => {
    const groupKeys = Object.keys(groups);
    if (!groupKeys.length) {
      content.innerHTML = `<div class="panel-placeholder">No units imported for ${SITES[site]} yet.</div>`;
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

  db.ref(`sites/${site}/groupInventory/${groupKey}/items`).once("value").then((snap) => {
    if (!snap.exists()) {
      panel.innerHTML = `<p style="color:var(--muted);">No inventory items set up for ${groupName} yet.</p>`;
      return;
    }
    const items = snap.val();
    const itemOptions = Object.entries(items).map(([key, item]) => `<option value="${key}">${item.name}</option>`).join("");

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
      const itemKey = document.getElementById("request-item-select").value;
      const itemName = items[itemKey].name;
      const note = document.getElementById("request-note-input").value.trim();
      const statusEl = document.getElementById("request-submit-status");

      db.ref(`sites/${site}/supplyRequests`).push({
        groupKey, groupName, itemKey, itemName, note,
        requestedByUid: currentUser.uid,
        requestedByName: `${currentUser.firstName} ${currentUser.lastName}`,
        requestedAt: firebase.database.ServerValue.TIMESTAMP,
        status: "open"
      }).then(() => {
        // Flag the item so admins see a "consider raising par" suggestion
        return db.ref(`sites/${site}/groupInventory/${groupKey}/items/${itemKey}/parRaisedSuggested`).set(true);
      }).then(() => {
        statusEl.style.color = "var(--success)";
        statusEl.textContent = `Request sent — Maintenance has been notified about ${itemName} at ${groupName}.`;
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
        db.ref(`sites/${site}/groupInventory/${key}/items`).once("value"),
        db.ref(`sites/${site}/groupInventory/${key}/counts`).once("value")
      ]).then(([itemsSnap, countsSnap]) => ({ key, name: groups[key].name, itemsSnap, countsSnap }))
    );

    Promise.all(groupFetches).then((groupResults) => {
      const orderRows = [];

      groupResults.forEach(({ key, name, itemsSnap, countsSnap }) => {
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
            orderRows.push({ groupKey: key, groupName: name, itemKey, itemName: item.name, parLevel: item.parLevel, ending, orderQty });
          }
        });
      });

      const requestsHtml = openRequests.length ? `
        <div class="card">
          <h3 style="color:var(--navy); margin-bottom:14px;">Open Mid-Event Requests</h3>
          ${openRequests.map(r => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
              <div>
                <strong>${r.itemName}</strong> — ${r.groupName}
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
          const qtyStr = prompt(`How many cases of "${req.itemName}" were delivered to ${req.groupName}?`, "1");
          if (qtyStr === null) return; // cancelled
          const qty = parseFloat(qtyStr);
          if (isNaN(qty) || qty <= 0) {
            alert("Enter a valid quantity greater than 0.");
            return;
          }

          db.ref(`sites/${site}/groupInventory/${req.groupKey}/counts`).push({
            type: "addition",
            countedByUid: currentUser.uid,
            countedByName: `${currentUser.firstName} ${currentUser.lastName}`,
            countedByRole: currentUser.role,
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
          const bodyLines = orderRows.map(r => `${r.groupName} — ${r.itemName}: order ${r.orderQty} cases (par ${r.parLevel}, ending ${r.ending})`);
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
          <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Role</label>
          <select id="add-staff-role" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px;">
            ${isSuperadmin
              ? `<option value="superadmin">Superadmin</option><option value="superuser">Super User</option><option value="user" selected>User</option><option value="maintenance">Maintenance</option><option value="preevent">Pre-Event</option><option value="executive">Executive</option><option value="inventory">Inventory</option>`
              : `<option value="user" selected>User</option><option value="maintenance">Maintenance</option><option value="preevent">Pre-Event</option><option value="inventory">Inventory</option>`}
          </select>
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
        Role must be superadmin / superuser / user / maintenance / preevent / executive / inventory. Site can be blank for superadmin or executive (defaults to "all").
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
  const addRoleSelect = document.getElementById("add-staff-role");
  const addSiteSelect = document.getElementById("add-staff-site");

  if (isSuperadmin) {
    addRoleSelect.addEventListener("change", () => {
      if (addRoleSelect.value === "superadmin" || addRoleSelect.value === "executive") {
        addSiteSelect.value = "all";
        addSiteSelect.disabled = true;
      } else {
        addSiteSelect.disabled = false;
      }
    });
  }

  document.getElementById("add-staff-btn").addEventListener("click", () => {
    const statusEl = document.getElementById("add-staff-status");
    const firstName = document.getElementById("add-staff-first").value.trim();
    const lastName = document.getElementById("add-staff-last").value.trim();
    const email = document.getElementById("add-staff-email").value.trim();
    const phone = document.getElementById("add-staff-phone").value.trim();
    const role = addRoleSelect.value;
    const site = (role === "superadmin" || role === "executive") ? "all" : addSiteSelect.value;

    if (!firstName || !lastName) {
      statusEl.style.color = "var(--danger)";
      statusEl.textContent = "First and last name are required.";
      return;
    }

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
      newUserRef.set({ firstName, lastName, email, phone, role, site, pin: newPin, active: true })
        .then(() => {
          statusEl.style.color = "var(--success)";
          statusEl.textContent = `Added ${firstName} ${lastName} — PIN ${newPin} (${ROLES[role].label}${site !== "all" ? ", " + SITES[site] : ""})`;
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
            const role = (row.role || "").trim().toLowerCase();
            let site = (row.site || "").trim().toLowerCase();
            let pin = (row.pin || "").trim();

            if (!firstName || !lastName) { errors.push(`Row ${i + 2}: missing first/last name`); return; }
            if (!VALID_ROLES.includes(role)) { errors.push(`Row ${i + 2}: role "${role}" must be superadmin, superuser, user, maintenance, preevent, executive, or inventory`); return; }
            if (role === "superadmin" || role === "executive") {
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
      if (u.site === site || ((u.role === "superadmin" || u.role === "executive") && currentUser.role === "superadmin")) {
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
      const canEditThisRole = isSuperadminViewer || (currentUser.role === "superuser" && ["user", "maintenance", "preevent", "inventory"].includes(u.role));
      const editableRoleOptions = isSuperadminViewer
        ? Object.keys(ROLES)
        : ["user", "maintenance", "preevent", "inventory"];
      const roleCell = canEditThisRole
        ? `<select class="role-edit" data-uid="${u.uid}" style="padding:4px; border:1px solid var(--border); border-radius:4px;">
            ${editableRoleOptions.map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${ROLES[r].label}</option>`).join("")}
          </select>`
        : ROLES[u.role] ? ROLES[u.role].label : u.role;
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

    container.querySelectorAll(".role-edit").forEach((select) => {
      select.addEventListener("change", () => {
        const uid = select.dataset.uid;
        const newRole = select.value;
        const updates = { role: newRole };
        // Org-wide roles (superadmin/executive) get site "all"; switching away from
        // one of those to a site-scoped role needs a real site — default to the
        // currently-viewed site since that's the context this edit happened in.
        if (newRole === "superadmin" || newRole === "executive") {
          updates.site = "all";
        } else {
          const user = relevantUsers.find(u => u.uid === uid);
          if (user.site === "all") updates.site = site;
        }
        db.ref(`users/${uid}`).update(updates)
          .then(() => loadStaffTable(site))
          .catch((err) => alert("Failed to update role: " + err.message));
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
