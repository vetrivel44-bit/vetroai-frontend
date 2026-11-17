// Runs before every /api route: refuses requests from a blocked IP address,
// and while maintenance mode is on (both set from the admin page) answers
// 503 to everyone but admins.
//
// Exempt: the health checks (hosting needs them), Stripe's webhook (payments
// must not be lost), and /api/admin (admins must always be able to get in).

const moderation = require("../services/moderationService");
const firebaseToken = require("../utils/firebaseToken");
const { errorResponse } = require("../utils/response");
const logger = require("../utils/logger");

const EXEMPT = /^\/api\/(health|admin(\/|$)|billing\/webhook)/;

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function callerIsAdmin(req) {
  const token = bearer(req);
  if (!token || token.split(".").length !== 3) return false;
  try {
    const payload = await firebaseToken.verifyFirebaseIdToken(token);
    return await moderation.isAdmin(payload.sub, token);
  } catch {
    return false;
  }
}

async function accessGate(req, res, next) {
  if (!req.path.startsWith("/api/") || EXEMPT.test(req.path)) return next();
  try {
    const ipBlock = await moderation.blockedIp(req.ip);
    if (ipBlock) {
      return errorResponse(res, "Access to VetroAI from this network has been blocked.", 403, { code: "IP_BLOCKED" });
    }
    const cfg = await moderation.appConfig();
    if (cfg?.maintenance?.on === true && !(await callerIsAdmin(req))) {
      const message = String(cfg.maintenance.message || "").trim() || "VetroAI is down for maintenance. Please try again soon.";
      return errorResponse(res, message, 503, { code: "MAINTENANCE" });
    }
  } catch (err) {
    logger.warn("accessGate.failed", { message: err.message });
  }
  return next();
}

module.exports = accessGate;
