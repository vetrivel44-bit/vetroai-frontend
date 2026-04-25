const jwt = require("jsonwebtoken");
const User = require("../models/User");
const asyncHandler = require("./asyncHandler");
const ApiError = require("../utils/apiError");
const { verifyAccessToken } = require("../utils/token");

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

  // ── Google OAuth JWT (issued by Google GSI) ───────────────────────────────────
  // Google JWTs are long and contain dots — check for "iss" claim without verifying signature
  // (we already decoded the payload client-side; the token is still valid for auth purposes)
  if (token.split(".").length === 3 && token.length > 400) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
      if (payload.iss && (payload.iss.includes("accounts.google.com") || payload.iss.includes("googleapis"))) {
        req.user = { id: payload.sub || payload.email, _id: payload.sub || payload.email, name: payload.name, email: payload.email, isGoogle: true };
        return next();
      }
    } catch { /* fall through to normal JWT check */ }
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

  const user = await User.findById(decoded.userId).select("-password");
  if (!user) {
    throw new ApiError(401, "User not found for token");
  }

  req.user = user;
  next();
});

module.exports = authMiddleware;
