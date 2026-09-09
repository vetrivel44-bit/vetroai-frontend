// Verification for Firebase Authentication ID tokens.
//
// The frontend signs in through Firebase Auth, so the bearer token it sends is
// a Firebase ID token — not the JWT this backend issues, and not a Google
// Identity Services token either. It is a JWT signed by Google with a rotating
// key, and it must be verified against Google's public certificates.
//
// This deliberately does NOT use firebase-admin. The Admin SDK needs a service
// account credential provisioned as a deployment secret, and pulls in a large
// dependency tree, to do what amounts to a standard RS256 verification against
// a published key set. Google documents this manual path for exactly this case
// ("verify ID tokens using a third-party JWT library"), and it needs nothing
// but the project id — which is public.
//
// The one capability given up is revocation checking: a token stays valid until
// it expires (max one hour) even if the session is revoked server-side. That
// matches how the previous Google-token path here behaved.
const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const logger = require("./logger");

// Google publishes the signing certificates for Firebase ID tokens here, keyed
// by the token header's `kid`.
const CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let certCache = { keys: null, expiresAt: 0 };
let inFlight = null;

function projectId() {
  return config.firebaseProjectId;
}

/**
 * Google rotates these keys roughly daily and states how long they may be
 * cached in the response's Cache-Control header. Honour it rather than
 * refetching per request, and collapse concurrent refreshes into one call.
 */
async function getCerts() {
  if (certCache.keys && Date.now() < certCache.expiresAt) return certCache.keys;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetch(CERT_URL);
    if (!res.ok) throw new Error(`certificate fetch failed with ${res.status}`);
    const keys = await res.json();

    const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
    // Fall back to an hour if the header is missing or unparseable.
    const ttlMs = (maxAge ? Number(maxAge[1]) : 3600) * 1000;

    certCache = { keys, expiresAt: Date.now() + ttlMs };
    return keys;
  })().finally(() => { inFlight = null; });

  return inFlight;
}

/** True if this looks like a Firebase ID token, without trusting its contents. */
function isFirebaseIdToken(payload) {
  const pid = projectId();
  return Boolean(pid) && payload?.iss === `https://securetoken.google.com/${pid}`;
}

/**
 * Verify a Firebase ID token and return its payload.
 * Throws if the signature, issuer, audience, expiry or subject is wrong.
 */
async function verifyFirebaseIdToken(token) {
  const pid = projectId();
  if (!pid) throw new Error("FIREBASE_PROJECT_ID is not configured");

  const header = JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString()
  );
  if (header.alg !== "RS256") throw new Error(`unexpected algorithm ${header.alg}`);
  if (!header.kid) throw new Error("token header has no key id");

  let certs = await getCerts();
  let cert = certs[header.kid];
  if (!cert) {
    // Key ids roll; a miss usually means our cache predates a rotation.
    certCache = { keys: null, expiresAt: 0 };
    certs = await getCerts();
    cert = certs[header.kid];
  }
  if (!cert) throw new Error("no public certificate matches the token's key id");

  // jsonwebtoken checks the signature, `exp`, and — because they are passed
  // here — that the audience and issuer are this Firebase project's.
  const payload = jwt.verify(token, cert, {
    algorithms: ["RS256"],
    audience: pid,
    issuer: `https://securetoken.google.com/${pid}`,
  });

  // `sub` is the Firebase uid and is what identifies the user. Firebase always
  // sets it, but a token without one must never be treated as authenticated.
  if (!payload.sub) throw new Error("token has no subject");

  return payload;
}

module.exports = { verifyFirebaseIdToken, isFirebaseIdToken };
