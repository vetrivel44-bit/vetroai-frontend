const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const asyncHandler = require("./asyncHandler");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { config } = require("../config/env");
const { verifyAccessToken } = require("../utils/token");

const googleClient = new OAuth2Client(config.googleClientId);

// Reads a JWT's payload WITHOUT validating it. Only ever used to decide which
// verifier a token should be handed to — never to trust anything it says.
function peekJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  } catch {
    return null;
  }
}

function isGoogleIssuer(iss) {
  return typeof iss === "string" && /(^|\.)accounts\.google\.com$|googleapis/.test(iss.replace(/^https?:\/\//, ""));
}

const authMiddleware = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new ApiError(401, "Bearer token missing");
  }

  // ── Offline / local-mode token (issued by frontend when backend is unreachable) ──
  if (token.startsWith("local_")) {
    // Attach a synthetic user object so controllers don't crash
    req.user = { id: "offline_user", _id: "offline_user", name: "Local User", email: "local@vetroai.app", isOffline: true };
    return next();
  }

  // ── Google ID token (issued by Google Identity Services) ─────────────────────
  // The signature MUST be verified. Decoding the payload proves nothing: anyone
  // can mint a JWT claiming iss "accounts.google.com" and any sub/email they
  // like, which previously authenticated them as that user.
  if (token.split(".").length === 3 && isGoogleIssuer(peekJwtPayload(token)?.iss)) {
    if (!config.googleClientId) {
      throw new ApiError(401, "Google sign-in is not configured on this server");
    }
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: token, audience: config.googleClientId });
      payload = ticket.getPayload();
    } catch (err) {
      logger.warn("auth.google.verify_failed", { message: err.message });
      throw new ApiError(401, "Invalid or expired Google token");
    }
    if (!payload?.sub) throw new ApiError(401, "Invalid Google token");

    // Prefer the account this Google identity maps to, so billing and cloud
    // sessions resolve to the same user the /api/auth/google exchange creates.
    let user = null;
    try {
      if (payload.email) user = await User.findOne({ email: payload.email }).select("-password");
    } catch (err) { logger.warn("auth.google.lookup_failed", { message: err.message }); }

    req.user = user || {
      id: payload.sub,
      _id: payload.sub,
      name: payload.name,
      email: payload.email,
      isGoogle: true,
    };
    return next();
  }

  // ── Standard JWT (issued by our own backend) ──────────────────────────────────
  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, "Access token expired");
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "Invalid access token");
    }
    throw err;
  }

  try {
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      throw new ApiError(401, "User not found for token");
    }
    req.user = user;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    req.user = { id: decoded.userId, _id: decoded.userId, name: "User", email: "", isOffline: true };
  }
  next();
});

module.exports = authMiddleware;
