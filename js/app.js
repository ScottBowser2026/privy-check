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
  // Placeholder shells — each will be built out with real data binding next
  const labels = {
    "pre-event": "Pre-Event Task List",
    "during-event": "During-Event Task List",
    "closing": "Closing Task List",
    "out-of-order": currentUser.role === "maintenance" ? "Flagged Units" : "Out-of-Order Reports",
    "admin": "Admin Panel"
  };
  content.innerHTML = `
    <div class="panel-placeholder">
      <h3 style="margin-bottom:8px;color:var(--navy)">${labels[tabId]}</h3>
      <p>This section is scaffolded and ready for data binding — coming in the next build pass.</p>
    </div>
  `;
}
