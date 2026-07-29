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
      const usersSnap = await db
        .ref("users")
        .orderByChild("phone")
        .equalTo(phone)
        .once("value");

      if (!usersSnap.exists()) {
        // No match — return the same generic response, no distinguishing signal
        return { message: GENERIC_MESSAGE };
      }

      const usersObj = usersSnap.val();
      const uid = Object.keys(usersObj)[0];
      const userRecord = usersObj[uid];

      if (userRecord.active === false) {
        // Inactive account — still return generic message, no confirmation
        return { message: GENERIC_MESSAGE };
      }

      const newPin = await generateUniquePin();

      await db.ref(`users/${uid}/pin`).set(newPin);

      const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
      await client.messages.create({
        body: `Your new Privy Check PIN is: ${newPin}. If you didn't request this, contact your Superadmin.`,
        from: TWILIO_FROM_NUMBER,
        to: phone
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
