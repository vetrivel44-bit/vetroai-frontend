// POST /api/auth/device — remembers where an account is signed in.
//
// The app calls this after sign-in and every so often while open. It saves
// the device's browser, system and IP address (which only the server can
// see) to users/{uid}/logins/{deviceId}, so the account owner and admins can
// see every place an account is being used from. The person can't delete
// these records themselves (firestore.rules): someone who got into an account
// can't wipe their tracks.

const ApiError = require("../utils/apiError");
const { successResponse } = require("../utils/response");
const { getDoc, patchDoc } = require("../utils/firestoreRest");
const logger = require("../utils/logger");

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const THROTTLE_MS = 10 * 60 * 1000;
const lastWrite = new Map(); // `${uid}/${deviceId}` -> ms

/** "Chrome on Windows" from a User-Agent string. */
function describeAgent(ua) {
  const s = String(ua || "");
  const browser = /Edg\//.test(s) ? "Edge"
    : /OPR\/|Opera/.test(s) ? "Opera"
    : /SamsungBrowser/.test(s) ? "Samsung Internet"
    : /Firefox\//.test(s) ? "Firefox"
    : /Chrome\//.test(s) ? "Chrome"
    : /Safari\//.test(s) ? "Safari"
    : /Electron\//.test(s) ? "Desktop app"
    : "Unknown browser";
  const os = /Android/.test(s) ? "Android"
    : /iPhone|iPad|iPod/.test(s) ? "iOS"
    : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "macOS"
    : /CrOS/.test(s) ? "ChromeOS"
    : /Linux/.test(s) ? "Linux"
    : "Unknown system";
  const mobile = /Mobi|Android|iPhone|iPad/.test(s);
  return { browser: /Electron\//.test(s) ? "Desktop app" : browser, os, mobile };
}

async function recordDevice(req, res) {
  const fa = req.firebaseAuth;
  if (!fa?.uid) throw new ApiError(401, "Please sign in.");
  const deviceId = String(req.body?.deviceId || "");
  if (!DEVICE_ID.test(deviceId)) throw new ApiError(400, "Invalid device id.");

  const key = `${fa.uid}/${deviceId}`;
  if ((lastWrite.get(key) || 0) + THROTTLE_MS > Date.now()) {
    return successResponse(res, "ok", { recorded: false });
  }
  lastWrite.set(key, Date.now());

  const ua = String(req.headers["user-agent"] || "").slice(0, 400);
  const { browser, os, mobile } = describeAgent(ua);
  const now = new Date();
  const path = `users/${fa.uid}/logins/${deviceId}`;
  try {
    const existing = await getDoc(path, fa.token);
    await patchDoc(path, {
      deviceId,
      browser,
      os,
      mobile,
      userAgent: ua,
      ip: String(req.ip || "").replace(/^::ffff:/, "").slice(0, 64),
      lastSeen: now,
      ...(existing?.firstSeen ? {} : { firstSeen: now }),
    }, fa.token);
  } catch (err) {
    lastWrite.delete(key);
    logger.warn("device.recordFailed", { uid: fa.uid, message: err.message });
    return successResponse(res, "not recorded", { recorded: false });
  }
  return successResponse(res, "ok", { recorded: true });
}

module.exports = { recordDevice, describeAgent };
