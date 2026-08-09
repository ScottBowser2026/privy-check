const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueCreated, onValueUpdated } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const twilio = require("twilio");

admin.initializeApp({
  databaseURL: "https://privy-check.firebaseio.com"
});

// Secrets — set via `firebase functions:secrets:set TWILIO_ACCOUNT_SID` etc.
// Never hardcoded, never present in any client-side file.
const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = "+18337491031"; // shared toll-free number, not sensitive

const db = admin.database();

/**
 * resetPinByPhone
 * Callable from the client. Looks up a user by phone number, generates a
 * new unique 4-digit PIN, updates their record, and texts it via Twilio.
 * Always returns the same generic message regardless of whether a match
 * was found — deliberately vague, per standard security pattern.
 */
exports.resetPinByPhone = onCall(
  { secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN] },
  async (request) => {
    const phone = (request.data && request.data.phone || "").trim();

    if (!phone) {
      throw new HttpsError("invalid-argument", "Phone number is required.");
    }

    const GENERIC_MESSAGE =
      "If that phone number is on file, a new PIN has been sent by text.";

    try {
      const digitsOnly = phone.replace(/\D/g, "");
      const usersSnap = await db.ref("users").once("value");

      let uid = null;
      let userRecord = null;
      usersSnap.forEach((child) => {
        const storedDigits = (child.val().phone || "").replace(/\D/g, "");
        if (storedDigits && storedDigits === digitsOnly) {
          uid = child.key;
          userRecord = child.val();
        }
      });

      if (!uid) {
        // No match — return the same generic response, no distinguishing signal
        return { message: GENERIC_MESSAGE };
      }

      if (userRecord.active === false) {
        // Inactive account — still return generic message, no confirmation
        return { message: GENERIC_MESSAGE };
      }

      const newPin = await generateUniquePin();

      await db.ref(`users/${uid}/pin`).set(newPin);

      const smsBody = `Your new Privy Check PIN is: ${newPin}. If you didn't request this, contact your Superadmin.`;
      const toNumber = toE164(phone);

      const settingsSnap = await db.ref("settings/sandboxMode").once("value");
      const sandboxMode = settingsSnap.val() === true;

      if (sandboxMode) {
        await db.ref("smsLog").push({
          to: toNumber,
          body: smsBody,
          type: "resetPinByPhone",
          sentReal: false,
          timestamp: admin.database.ServerValue.TIMESTAMP
        });
        return {
          message: `[SANDBOX MODE] No real text was sent. Generated PIN for testing: ${newPin}`
        };
      }

      const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
      await client.messages.create({
        body: smsBody,
        from: TWILIO_FROM_NUMBER,
        to: toNumber
      });

      await db.ref("smsLog").push({
        to: toNumber,
        body: smsBody,
        type: "resetPinByPhone",
        sentReal: true,
        timestamp: admin.database.ServerValue.TIMESTAMP
      });

      return { message: GENERIC_MESSAGE };
    } catch (err) {
      console.error("resetPinByPhone error:", err);
      // Even on internal error, don't leak details to the client
      return { message: GENERIC_MESSAGE };
    }
  }
);

/**
 * Normalizes a US phone number to E.164 format for Twilio.
 * Strips non-digits; assumes US (+1) if 10 digits; passes through
 * if already 11 digits starting with 1, or already has a +.
 */
function toE164(rawPhone) {
  if (rawPhone.startsWith("+")) return rawPhone;
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`; // fallback, best effort
}

/**
 * Sends a text via Twilio, or logs it instead if Sandbox Mode is on —
 * shared by every function that needs to text someone, so sandbox
 * behavior stays consistent everywhere.
 */
async function sendSmsOrLog(rawPhone, body, type) {
  const toNumber = toE164(rawPhone);

  const settingsSnap = await db.ref("settings/sandboxMode").once("value");
  const sandboxMode = settingsSnap.val() === true;

  if (sandboxMode) {
    await db.ref("smsLog").push({
      to: toNumber, body, type, sentReal: false,
      timestamp: admin.database.ServerValue.TIMESTAMP
    });
    return;
  }

  const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
  await client.messages.create({ body, from: TWILIO_FROM_NUMBER, to: toNumber });

  await db.ref("smsLog").push({
    to: toNumber, body, type, sentReal: true,
    timestamp: admin.database.ServerValue.TIMESTAMP
  });
}

/**
 * Finds phone numbers for everyone at a site holding a given role AND
 * currently flagged MOD (on duty). Works with both the new "roles" object
 * and legacy single "role" string records.
 */
async function getModPhoneNumbers(site, roleKey) {
  const usersSnap = await db.ref("users").once("value");
  const numbers = [];
  usersSnap.forEach((child) => {
    const u = child.val();
    const hasThisRole = (u.roles && u.roles[roleKey]) || u.role === roleKey;
    if (hasThisRole && u.site === site && u.isMOD === true && u.active !== false && u.phone) {
      numbers.push(u.phone);
    }
  });
  return numbers;
}

/**
 * Same as getModPhoneNumbers, but returns {name, phone} pairs instead of
 * just phone numbers — used where the name is needed too (e.g. telling a
 * Super User which tech an alert went to).
 */
async function getModContacts(site, roleKey) {
  const usersSnap = await db.ref("users").once("value");
  const contacts = [];
  usersSnap.forEach((child) => {
    const u = child.val();
    const hasThisRole = (u.roles && u.roles[roleKey]) || u.role === roleKey;
    if (hasThisRole && u.site === site && u.isMOD === true && u.active !== false && u.phone) {
      contacts.push({ name: `${u.firstName} ${u.lastName}`, phone: u.phone });
    }
  });
  return contacts;
}

/**
 * sendSupplyRequestAlert
 * Fires when a User submits a mid-event supply request. Routes the full
 * request directly to on-duty (MOD) Maintenance — they're the ones who act
 * on it. Super User only gets a shorter "this was sent to Maintenance"
 * notification, mirroring the Out of Order alert pattern.
 */
exports.sendSupplyRequestAlert = onValueCreated(
  {
    ref: "sites/{site}/supplyRequests/{requestId}",
    instance: "privy-check",
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN]
  },
  async (event) => {
    const site = event.params.site;
    const req = event.data.val();
    if (!req) return;

    try {
      const [maintenanceContacts, superuserPhones] = await Promise.all([
        getModContacts(site, "maintenance"),
        getModPhoneNumbers(site, "superuser")
      ]);

      const maintenanceBody = `Privy Check: ${req.itemName} needed at ${req.groupName} (${req.sex}). Requested by ${req.requestedByName}.`;
      await Promise.all(maintenanceContacts.map(c => sendSmsOrLog(c.phone, maintenanceBody, "supplyRequestCreated")));

      if (superuserPhones.length) {
        const namesList = maintenanceContacts.length
          ? maintenanceContacts.map(c => c.name).join(", ")
          : "no on-duty Maintenance tech";
        const superuserBody = `Privy Check: ${req.itemName} requested at ${req.groupName} — alert sent to Maintenance MOD (${namesList}).`;
        await Promise.all(superuserPhones.map(phone => sendSmsOrLog(phone, superuserBody, "supplyRequestNotified")));
      }
    } catch (err) {
      console.error("sendSupplyRequestAlert error:", err);
    }
  }
);

/**
 * sendOutOfOrderFlagAlert
 * Fires the moment a User flags a unit out of order. Texts on-duty (MOD)
 * Maintenance so they know to respond, and separately confirms to on-duty
 * (MOD) Super Users that the alert actually went out (with the maintenance
 * tech's name+phone so they can call to confirm receipt if needed).
 */
exports.sendOutOfOrderFlagAlert = onValueCreated(
  {
    ref: "sites/{site}/outOfOrder/{flagId}",
    instance: "privy-check",
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN]
  },
  async (event) => {
    const site = event.params.site;
    const flag = event.data.val();
    if (!flag) return;

    try {
      const maintenanceContacts = await getModContacts(site, "maintenance");
      const superuserPhones = await getModPhoneNumbers(site, "superuser");

      const maintenanceBody = `Privy Check ALERT: ${flag.unitName} flagged out of order — ${flag.reason}${flag.notes ? " (" + flag.notes + ")" : ""}. Flagged by ${flag.flaggedByName}.`;
      await Promise.all(maintenanceContacts.map(c => sendSmsOrLog(c.phone, maintenanceBody, "outOfOrderFlagCreated")));

      if (superuserPhones.length) {
        const namesList = maintenanceContacts.length
          ? maintenanceContacts.map(c => c.name).join(", ")
          : "no on-duty Maintenance tech";
        const superuserBody = `Privy Check: ${flag.unitName} flagged (${flag.reason}) — alert sent to Maintenance MOD (${namesList}).`;
        await Promise.all(superuserPhones.map(phone => sendSmsOrLog(phone, superuserBody, "outOfOrderFlagNotified")));
      }
    } catch (err) {
      console.error("sendOutOfOrderFlagAlert error:", err);
    }
  }
);

/**
 * sendMedicalAlertNotification
 * Fires the instant a Medical Alert is triggered (hold-to-confirm in the
 * app). Texts on-duty (MOD) Security and Super User immediately — this is
 * the highest-priority alert in the system, so it deliberately does NOT
 * respect Sandbox Mode; it always sends for real.
 */
exports.sendMedicalAlertNotification = onValueCreated(
  {
    ref: "sites/{site}/medicalAlerts/{alertId}",
    instance: "privy-check",
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN]
  },
  async (event) => {
    const site = event.params.site;
    const alert = event.data.val();
    if (!alert) return;

    try {
      const [securityPhones, superuserPhones] = await Promise.all([
        getModPhoneNumbers(site, "security"),
        getModPhoneNumbers(site, "superuser")
      ]);
      const phones = [...new Set([...securityPhones, ...superuserPhones])];
      if (!phones.length) return;

      const body = `MEDICAL ALERT at ${alert.locationName}. Reported by ${alert.triggeredByName}.`;
      const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());

      await Promise.all(phones.map(phone =>
        client.messages.create({ body, from: TWILIO_FROM_NUMBER, to: toE164(phone) })
          .then(() => db.ref("smsLog").push({
            to: toE164(phone), body, type: "medicalAlert", sentReal: true,
            timestamp: admin.database.ServerValue.TIMESTAMP
          }))
          .catch((err) => console.error(`Medical alert SMS failed for ${phone}:`, err))
      ));
    } catch (err) {
      console.error("sendMedicalAlertNotification error:", err);
    }
  }
);

/**
 * sendSupplyFulfilledAlert
 * Fires when a supply request is marked fulfilled. Sends the full delivery
 * confirmation (item, quantity, who delivered it) to on-duty Maintenance MOD
 * for their own record-keeping/accountability, and a short soft alert to
 * Super User just letting them know it's handled.
 */
exports.sendSupplyFulfilledAlert = onValueUpdated(
  {
    ref: "sites/{site}/supplyRequests/{requestId}",
    instance: "privy-check",
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN]
  },
  async (event) => {
    const site = event.params.site;
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (!after || !before) return;
    if (before.status === "fulfilled" || after.status !== "fulfilled") return;

    try {
      const [maintenancePhones, superuserPhones] = await Promise.all([
        getModPhoneNumbers(site, "maintenance"),
        getModPhoneNumbers(site, "superuser")
      ]);

      const maintenanceBody = `Privy Check: Delivery confirmed — ${after.fulfilledQty ?? "?"} case(s) of ${after.itemName} delivered to ${after.groupName} (${after.sex}) by ${after.fulfilledByName}.`;
      await Promise.all(maintenancePhones.map(phone => sendSmsOrLog(phone, maintenanceBody, "supplyRequestFulfilled")));

      if (superuserPhones.length) {
        const softBody = `Privy Check: Supplies delivered to ${after.groupName}.`;
        await Promise.all(superuserPhones.map(phone => sendSmsOrLog(phone, softBody, "supplyRequestFulfilledSoft")));
      }
    } catch (err) {
      console.error("sendSupplyFulfilledAlert error:", err);
    }
  }
);

/**
 * Generates a random 4-digit PIN not already in use by any user.
 */
async function generateUniquePin() {
  const usersSnap = await db.ref("users").once("value");
  const existingPins = new Set();
  usersSnap.forEach((child) => {
    const pin = child.val().pin;
    if (pin) existingPins.add(pin);
  });

  let candidate;
  let attempts = 0;
  do {
    candidate = String(Math.floor(1000 + Math.random() * 9000));
    attempts++;
  } while (existingPins.has(candidate) && attempts < 50);

  return candidate;
}

/**
 * checkStaleOutOfOrderFlags
 * Runs every 15 minutes. When Maintenance marks a job "Still Needs Repair,"
 * it goes back to open with a reopenedAt timestamp. If it's still sitting
 * open (unassigned) an hour later, Super User gets texted once. Clears and
 * re-arms if the job cycles through "still needs repair" again later.
 */
exports.checkStaleOutOfOrderFlags = onSchedule(
  {
    schedule: "every 15 minutes",
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN]
  },
  async () => {
    const sites = ["parf", "srf", "krf", "garf"];
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const site of sites) {
      try {
        const snap = await db.ref(`sites/${site}/outOfOrder`).once("value");
        if (!snap.exists()) continue;

        const staleFlags = [];
        snap.forEach((child) => {
          const f = child.val();
          if (
            f.status === "open" &&
            f.wasReassigned === true &&
            f.reopenedAt &&
            f.reopenedAt <= oneHourAgo &&
            !f.escalatedAt
          ) {
            staleFlags.push({ flagId: child.key, ...f });
          }
        });
        if (!staleFlags.length) continue;

        const superuserPhones = await getModPhoneNumbers(site, "superuser");
        if (!superuserPhones.length) continue;

        await Promise.all(staleFlags.map(async (f) => {
          const body = `Privy Check: ${f.unitName} at ${site.toUpperCase()} has been unassigned for over an hour after Maintenance marked it "still needs repair."`;
          await Promise.all(superuserPhones.map(phone => sendSmsOrLog(phone, body, "outOfOrderStaleEscalation")));
          await db.ref(`sites/${site}/outOfOrder/${f.flagId}`).update({ escalatedAt: Date.now() });
        }));
      } catch (err) {
        console.error(`checkStaleOutOfOrderFlags error for ${site}:`, err);
      }
    }
  }
);
