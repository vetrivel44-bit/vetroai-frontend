const bcrypt = require("bcrypt");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");
const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require("../utils/token");

// ── DB availability check ─────────────────────────────────────────────────────
const mongoose = require("mongoose");
let User, RefreshToken;
try {
  User = require("../models/User");
  RefreshToken = require("../models/RefreshToken");
} catch {}

function isDbAvailable() {
  return mongoose.connection.readyState === 1;
}

const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(config.googleClientId);

// ── In-memory user store (when MongoDB is unavailable) ───────────────────────
const inMemoryUsers = new Map();

const DUMMY_HASH = "$2b$12$KIXm2iQv6OAqAwCQc.ByqO.8Qqw8/ai8FHpE8IKFQZM7Ta03j3Z62";

async function issueTokens(userId) {
  const accessToken  = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  if (isDbAvailable()) {
    try {
      await RefreshToken.create({ userId, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) });
    } catch { /* DB unavailable, skip */ }
  }
  return { accessToken, refreshToken };
}

async function signup(req, res) {
  const { email, password, name } = req.validated.body;

  if (isDbAvailable()) {
    try {
      const existing = await User.findOne({ email });
      if (existing) throw new ApiError(409, "Email already registered");
      const hashed = await bcrypt.hash(password, config.bcryptSaltRounds || 12);
      const user   = await User.create({ email, password: hashed, name });
      const tokens = await issueTokens(user.id);
      logger.info("auth.signup.success", { userId: user.id });
      return successResponse(res, "Signup successful", { user: { id: user.id, email, name }, ...tokens }, 201);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.info("auth.signup.db_fallback", { message: err.message });
      // Fall through to in-memory
    }
  }

  // In-memory signup (offline mode)
  if (inMemoryUsers.has(email)) throw new ApiError(409, "Email already registered");
  const hashed = await bcrypt.hash(password, 8); // fewer rounds for speed in memory mode
  const userId = `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  inMemoryUsers.set(email, { id: userId, email, name, password: hashed });
  const tokens = await issueTokens(userId);
  logger.info("auth.signup.inmemory", { email });
  return successResponse(res, "Signup successful (offline mode)", { user: { id: userId, email, name }, ...tokens }, 201);
}

async function login(req, res) {
  const { email, password } = req.validated.body;

  if (isDbAvailable()) {
    try {
      const user = await User.findOne({ email });
      if (user && user.lockUntil && user.lockUntil > new Date()) {
        throw new ApiError(429, "Account temporarily locked. Try again in 15 minutes.");
      }
      const hash    = user ? user.password : DUMMY_HASH;
      const valid   = await bcrypt.compare(password, hash);
      if (!user || !valid) {
        if (user) { user.loginAttempts = (user.loginAttempts || 0) + 1; if (user.loginAttempts >= 5) { user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); user.loginAttempts = 0; } await user.save(); }
        throw new ApiError(401, "Invalid credentials");
      }
      user.loginAttempts = 0; user.lockUntil = null; await user.save();
      const tokens = await issueTokens(user.id);
      logger.info("auth.login.success", { userId: user.id });
      return successResponse(res, "Login successful", { user: { id: user.id, email: user.email, name: user.name }, ...tokens });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.info("auth.login.db_fallback", { message: err.message });
    }
  }

  // In-memory login
  const stored = inMemoryUsers.get(email);
  if (!stored) {
    // Auto-create account in offline mode for convenience
    const hashed = await bcrypt.hash(password, 8);
    const userId = `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const name   = email.split("@")[0];
    inMemoryUsers.set(email, { id: userId, email, name, password: hashed });
    const tokens = await issueTokens(userId);
    logger.info("auth.login.inmemory_autocreate", { email });
    return successResponse(res, "Login successful (offline mode — account auto-created)", { user: { id: userId, email, name }, ...tokens });
  }
  const valid = await bcrypt.compare(password, stored.password);
  if (!valid) throw new ApiError(401, "Invalid credentials");
  const tokens = await issueTokens(stored.id);
  logger.info("auth.login.inmemory", { email });
  return successResponse(res, "Login successful (offline mode)", { user: { id: stored.id, email, name: stored.name }, ...tokens });
}

async function googleLogin(req, res) {
  const { token } = req.body;
  if (!token) throw new ApiError(400, "Google token is required");

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch (err) {
    throw new ApiError(401, "Invalid Google token");
  }

  const { email, name, picture } = payload;

  if (isDbAvailable()) {
    try {
      let user = await User.findOne({ email });
      if (!user) {
        const randomPass = require("crypto").randomBytes(32).toString("hex");
        const hashed = await bcrypt.hash(randomPass, 10);
        user = await User.create({ email, name, password: hashed });
      }
      const tokens = await issueTokens(user.id);
      logger.info("auth.google.success", { userId: user.id });
      return successResponse(res, "Google login successful", { user: { id: user.id, email, name, picture }, ...tokens });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error("auth.google.db_error", { message: err.message });
      // fallback to in-memory below
    }
  }

  // In-memory fallback
  let stored = inMemoryUsers.get(email);
  if (!stored) {
    const userId = `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    inMemoryUsers.set(email, { id: userId, email, name, password: "google_oauth_no_password" });
    stored = inMemoryUsers.get(email);
  }
  const tokens = await issueTokens(stored.id);
  logger.info("auth.google.inmemory", { email });
  return successResponse(res, "Google login successful (offline mode)", { user: { id: stored.id, email, name, picture }, ...tokens });
}

// A refresh token is only tracked in Mongo for DB-backed accounts; offline
// (in-memory) users have nothing stored, so the JWT signature is all we have.
function isTrackedUser(userId) {
  return isDbAvailable() && mongoose.isValidObjectId(userId);
}

async function refreshToken(req, res) {
  const { refreshToken: inputToken } = req.validated.body;
  let decoded;
  try { decoded = verifyRefreshToken(inputToken); }
  catch { throw new ApiError(401, "Invalid or expired refresh token"); }

  // Rotate: each refresh token is single-use, so replaying an old one after the
  // real client has refreshed — or after a logout — is refused. A token with no
  // record at all is still accepted (offline accounts, or a login whose record
  // write lost a race with a Mongo blip); revocation is what the record proves.
  if (isTrackedUser(decoded.userId)) {
    let stored = null;
    try {
      stored = await RefreshToken.findOne({ userId: decoded.userId, tokenHash: hashToken(inputToken) });
    } catch (err) {
      logger.warn("auth.refresh.lookup_failed", { message: err.message });
    }
    if (stored && (stored.revokedAt || stored.expiresAt <= new Date())) {
      logger.warn("auth.refresh.replayed", { userId: String(decoded.userId) });
      throw new ApiError(401, "Refresh token has been revoked");
    }
    if (stored) {
      stored.revokedAt = new Date();
      await stored.save().catch(() => {});
    }
  }

  const tokens = await issueTokens(decoded.userId);
  return successResponse(res, "Token refreshed", tokens);
}

async function logout(req, res) {
  const { refreshToken: inputToken } = req.validated.body;
  let decoded = null;
  try { decoded = verifyRefreshToken(inputToken); } catch { /* already unusable */ }

  if (decoded && isTrackedUser(decoded.userId)) {
    try {
      await RefreshToken.updateOne(
        { userId: decoded.userId, tokenHash: hashToken(inputToken), revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      logger.info("auth.logout.revoked", { userId: decoded.userId });
    } catch (err) {
      logger.warn("auth.logout.revoke_failed", { message: err.message });
    }
  }
  return successResponse(res, "Logged out successfully", null);
}

async function logoutAll(req, res) {
  const userId = req.user?._id || req.user?.id;
  if (isTrackedUser(userId)) {
    try {
      const result = await RefreshToken.updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      logger.info("auth.logoutAll.revoked", { userId: String(userId), count: result.modifiedCount });
    } catch (err) {
      logger.warn("auth.logoutAll.revoke_failed", { message: err.message });
    }
  }
  return successResponse(res, "Logged out from all devices", null);
}

module.exports = { signup, login, googleLogin, refreshToken, logout, logoutAll };
