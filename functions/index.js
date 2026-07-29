const { onCall, HttpsError } = require("firebase-functions/v2/https");
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
