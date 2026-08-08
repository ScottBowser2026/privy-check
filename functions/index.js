const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueCreated, onValueUpdated } = require("firebase-functions/v2/database");
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
 * sendSupplyRequestAlert
 * Fires when a User submits a mid-event supply request. Texts every
 * on-duty (MOD) Super User and Maintenance tech at that site.
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
      const [superuserPhones, maintenancePhones] = await Promise.all([
        getModPhoneNumbers(site, "superuser"),
        getModPhoneNumbers(site, "maintenance")
      ]);
      const phones = [...new Set([...superuserPhones, ...maintenancePhones])];
      if (!phones.length) return;

      const body = `Privy Check: ${req.itemName} needed at ${req.groupName} (${req.sex}). Requested by ${req.requestedByName}.`;
      await Promise.all(phones.map(phone => sendSmsOrLog(phone, body, "supplyRequestCreated")));
    } catch (err) {
      console.error("sendSupplyRequestAlert error:", err);
    }
  }
);

/**
 * sendSupplyFulfilledAlert
 * Fires when a supply request's status changes to "fulfilled". Texts
 * on-duty (MOD) Super Users at that site with what was delivered.
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
      const superuserPhones = await getModPhoneNumbers(site, "superuser");
      if (!superuserPhones.length) return;

      const body = `Privy Check: ${after.itemName} at ${after.groupName} (${after.sex}) fulfilled by ${after.fulfilledByName} — ${after.fulfilledQty ?? "?"} cases delivered.`;
      await Promise.all(superuserPhones.map(phone => sendSmsOrLog(phone, body, "supplyRequestFulfilled")));
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

