// Optional Google service account, for the admin controls that need more
// than the signed-in person's own token:
//   - disabling a Firebase account (no sign-in at all) and enabling it again
//   - signing an account out on every device
//   - reading the blocked-IP list, which no user may read
//
// Set FIREBASE_SERVICE_ACCOUNT on the server to the service account's JSON key
// (the file's contents, or the same base64-encoded). Without it everything
// else in the admin page still works; these few controls say they need it.
//
// No Admin SDK: a signed JWT is swapped for an OAuth access token (Google's
// documented "service account → access token" flow), cached until it expires.

const jwt = require("jsonwebtoken");
const logger = require("./logger");

const SCOPE = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let parsed; // undefined = not read yet, null = not configured
let cached = { token: null, expiresAt: 0 };
let inFlight = null;

function credentials() {
  if (parsed !== undefined) return parsed;
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  parsed = null;
  if (!raw) return parsed;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const json = JSON.parse(text);
    if (json.client_email && json.private_key) {
      parsed = { email: json.client_email, key: json.private_key.replace(/\\n/g, "\n"), projectId: json.project_id };
    } else {
      logger.warn("serviceAccount.invalid", { reason: "missing client_email or private_key" });
    }
  } catch (err) {
    logger.warn("serviceAccount.invalid", { reason: err.message });
  }
  return parsed;
}

function isConfigured() {
  return Boolean(credentials());
}

async function accessToken() {
  const creds = credentials();
  if (!creds) throw Object.assign(new Error("FIREBASE_SERVICE_ACCOUNT is not set on the server"), { code: "NO_SERVICE_ACCOUNT" });
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      { iss: creds.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
      creds.key,
      { algorithm: "RS256" }
    );
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`service account token request failed with ${res.status}`);
    const body = await res.json();
    cached = { token: body.access_token, expiresAt: Date.now() + Math.max(60, (body.expires_in || 3600) - 120) * 1000 };
    return cached.token;
  })().finally(() => { inFlight = null; });

  return inFlight;
}

// For tests.
function _reset() {
  parsed = undefined;
  cached = { token: null, expiresAt: 0 };
}

module.exports = { isConfigured, accessToken, _reset };
