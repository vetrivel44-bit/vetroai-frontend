// The admin page's server-side controls (/api/admin). Everything else the
// admin page does — blocking, warnings, the IP list, app settings, the audit
// log, reading chats for a legal request — it does straight in Firestore,
// where the security rules let only admins do it. These are the few actions
// Firestore can't do: they act on the Firebase sign-in account itself, so
// they need the service account (FIREBASE_SERVICE_ACCOUNT).

const ApiError = require("../utils/apiError");
const { successResponse } = require("../utils/response");
const serviceAccount = require("../utils/serviceAccount");
const moderation = require("../services/moderationService");
const { config } = require("../config/env");
const logger = require("../utils/logger");

const UID = /^[A-Za-z0-9_-]{1,128}$/;

function uidParam(req) {
  const uid = String(req.params.uid || "");
  if (!UID.test(uid)) throw new ApiError(400, "That is not a valid user id.");
  return uid;
}

async function identityToolkit(method, body) {
  let token;
  try {
    token = await serviceAccount.accessToken();
  } catch (err) {
    if (err.code === "NO_SERVICE_ACCOUNT") {
      throw new ApiError(501, "This control needs the server's service account. Set FIREBASE_SERVICE_ACCOUNT on the server (see docs/admin.md).", { code: "NO_SERVICE_ACCOUNT" });
    }
    throw new ApiError(502, "Could not reach Google to make this change. Try again in a minute.");
  }
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(config.firebaseProjectId)}/accounts:${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.warn("admin.identityToolkit.failed", { method, status: res.status, message: data?.error?.message });
    if (data?.error?.message === "USER_NOT_FOUND") throw new ApiError(404, "There is no sign-in account with that id.");
    throw new ApiError(502, `Google refused the change (${data?.error?.message || res.status}).`);
  }
  return data;
}

/** GET /api/admin/status — what the admin page can and can't do here. */
async function status(req, res) {
  const cfg = await moderation.appConfig();
  return successResponse(res, "ok", {
    admin: { uid: req.user.id || req.user._id, email: req.user.email },
    serviceAccount: serviceAccount.isConfigured(),
    maintenance: cfg?.maintenance?.on === true,
  });
}

/** GET /api/admin/users/:uid/account — the Firebase sign-in record. */
async function account(req, res) {
  const uid = uidParam(req);
  const data = await identityToolkit("lookup", { localId: [uid] });
  const u = data.users?.[0];
  if (!u) throw new ApiError(404, "There is no sign-in account with that id.");
  const ms = (v) => (v ? new Date(Number(v)).toISOString() : null);
  return successResponse(res, "ok", {
    uid: u.localId,
    email: u.email || null,
    emailVerified: Boolean(u.emailVerified),
    disabled: Boolean(u.disabled),
    providers: (u.providerUserInfo || []).map((p) => p.providerId),
    createdAt: ms(u.createdAt),
    lastLoginAt: ms(u.lastLoginAt),
    lastRefreshAt: u.lastRefreshAt || null,
    signedOutBefore: u.validSince ? new Date(Number(u.validSince) * 1000).toISOString() : null,
  });
}

/** POST /api/admin/users/:uid/disable { disabled } — turn sign-in off or back on. */
async function setDisabled(req, res) {
  const uid = uidParam(req);
  const disabled = req.body?.disabled !== false;
  if (disabled && uid === (req.firebaseAuth?.uid)) throw new ApiError(400, "You can't disable your own admin account.");
  await identityToolkit("update", { localId: uid, disableUser: disabled });
  logger.info("admin.setDisabled", { by: req.firebaseAuth?.uid, uid, disabled });
  return successResponse(res, disabled ? "Sign-in disabled" : "Sign-in enabled", { uid, disabled });
}

/** POST /api/admin/users/:uid/revoke — sign the account out on every device. */
async function revokeSessions(req, res) {
  const uid = uidParam(req);
  const validSince = String(Math.floor(Date.now() / 1000));
  await identityToolkit("update", { localId: uid, validSince });
  logger.info("admin.revokeSessions", { by: req.firebaseAuth?.uid, uid });
  return successResponse(res, "Signed out everywhere", { uid, signedOutBefore: new Date(Number(validSince) * 1000).toISOString() });
}

module.exports = { status, account, setDisabled, revokeSessions };
