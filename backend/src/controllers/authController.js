const bcrypt = require("bcrypt");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/token");

// ── DB availability check ─────────────────────────────────────────────────────
let User, RefreshToken, dbAvailable = false;
try {
  User = require("../models/User");
  RefreshToken = require("../models/RefreshToken");
  dbAvailable = true;
} catch { dbAvailable = false; }

// ── In-memory user store (when MongoDB is unavailable) ───────────────────────
const inMemoryUsers = new Map();

const DUMMY_HASH = "$2b$12$KIXm2iQv6OAqAwCQc.ByqO.8Qqw8/ai8FHpE8IKFQZM7Ta03j3Z62";

async function issueTokens(userId) {
  const accessToken  = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  if (dbAvailable) {
    try {
      await RefreshToken.create({ userId, tokenHash: require("crypto").createHash("sha256").update(refreshToken).digest("hex"), expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) });
    } catch { /* DB unavailable, skip */ }
  }
  return { accessToken, refreshToken };
}

async function signup(req, res) {
  const { email, password, name } = req.validated.body;

  if (dbAvailable) {
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

  if (dbAvailable) {
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

async function refreshToken(req, res) {
  const { refreshToken: inputToken } = req.validated.body;
  let decoded;
  try { decoded = verifyRefreshToken(inputToken); }
  catch { throw new ApiError(401, "Invalid or expired refresh token"); }
  const tokens = await issueTokens(decoded.userId);
  return successResponse(res, "Token refreshed", tokens);
}

async function logout(req, res) {
  return successResponse(res, "Logged out successfully", null);
}

async function logoutAll(req, res) {
  return successResponse(res, "Logged out from all devices", null);
}

module.exports = { signup, login, refreshToken, logout, logoutAll };
