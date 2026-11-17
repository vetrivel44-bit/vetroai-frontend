const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const asyncHandler = require("./asyncHandler");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { config } = require("../config/env");
const { verifyAccessToken } = require("../utils/token");
const firebaseToken = require("../utils/firebaseToken");
const moderation = require("../services/moderationService");

const googleClient = new OAuth2Client(config.googleClientId);

// The account lookups below are only worth making with a database to ask.
const dbReady = () => mongoose.connection.readyState === 1;

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

const PUBLIC_JWT_SECRET = "vetroai_dev_secret_fallback_2024";
function usingPublicJwtSecret() {
  const secret = config.jwtSecret || process.env.JWT_SECRET || PUBLIC_JWT_SECRET;
  const deployed = config.nodeEnv === "production" || Boolean(process.env.RENDER);
  return deployed && secret === PUBLIC_JWT_SECRET;
}

function blockedError(block) {
  const err = new ApiError(403, "This account has been suspended. If you think this is a mistake, contact VetroAI support.", {
    code: "ACCOUNT_BLOCKED",
    reason: block.publicReason || null,
  });
  err.code = "ACCOUNT_BLOCKED";
  return err;
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

  // ── Offline / local-mode token ──
  // The app makes these up itself when the server can't be reached, and never
  // sends them here. They used to be accepted as a signed-in "Local User",
  // which let anyone use every signed-in route with "Bearer local_x" and no
  // account at all — so nobody could ever be blocked.
  if (token.startsWith("local_")) {
    throw new ApiError(401, "Please sign in to use this.");
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
      if (payload.email && dbReady()) user = await User.findOne({ email: payload.email }).select("-password");
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

  // ── Firebase ID token (issued by Firebase Authentication) ────────────────────
  // This is the normal case now: the frontend signs in with Firebase, so every
  // authenticated request carries a Firebase ID token. Like the Google branch
  // above, the signature MUST be verified — the payload alone proves nothing.
  if (token.split(".").length === 3 && firebaseToken.isFirebaseIdToken(peekJwtPayload(token))) {
    let payload;
    try {
      payload = await firebaseToken.verifyFirebaseIdToken(token);
    } catch (err) {
      logger.warn("auth.firebase.verify_failed", { message: err.message });
      throw new ApiError(401, "Invalid or expired Firebase token");
    }

    // An email + password account must have confirmed its address. Without
    // this, anyone could sign up with an email they don't own and use the
    // API directly. Google sign-ins arrive already verified.
    if (payload.firebase?.sign_in_provider === "password" && payload.email_verified !== true) {
      throw new ApiError(403, "Please verify your email address before using VetroAI.");
    }

    // Blocked from the admin page (moderation/{uid}).
    const block = await moderation.isBlocked(payload.sub, token);
    if (block) throw blockedError(block);

    // Map onto the local account when one exists, so billing and cloud sessions
    // resolve to the same user regardless of which token type authenticated the
    // request. Firebase's uid is the identity of record when it does not.
    let user = null;
    try {
      if (payload.email && dbReady()) user = await User.findOne({ email: payload.email }).select("-password");
    } catch (err) { logger.warn("auth.firebase.lookup_failed", { message: err.message }); }

    req.user = user || {
      id: payload.sub,
      _id: payload.sub,
      name: payload.name || payload.email?.split("@")[0] || "User",
      email: payload.email || "",
      isFirebase: true,
    };
    // Lets the server keep this person's own records (usage) in their
    // Firestore space, under the same security rules as the app.
    req.firebaseAuth = { uid: payload.sub, token };
    return next();
  }

  // ── Standard JWT (issued by our own backend) ──────────────────────────────────
  // The fallback secret is published in this repository, so a token signed
  // with it proves nothing: anyone could mint one. Once deployed, these tokens
  // only count after a real JWT_SECRET is set.
  if (usingPublicJwtSecret()) {
    throw new ApiError(401, "Invalid access token");
  }
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
    if (!dbReady()) throw new Error("no database");
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
module.exports.blockedError = blockedError;
