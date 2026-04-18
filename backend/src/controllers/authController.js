const bcrypt = require("bcrypt");
const ms = require("ms");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require("../utils/token");

const MAX_LOGIN_ATTEMPTS = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_HASH = "$2b$12$KIXm2iQv6OAqAwCQc.ByqO.8Qqw8/ai8FHpE8IKFQZM7Ta03j3Z62";

function parseExpiryToDate(duration) {
  const millis = ms(duration);
  if (!millis) throw new Error(`Invalid duration value: ${duration}`);
  return new Date(Date.now() + millis);
}

async function issueTokenPair(userId) {
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);

  await RefreshToken.create({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: parseExpiryToDate(config.jwtRefreshExpiresIn),
  });

  return { accessToken, refreshToken };
}

async function signup(req, res) {
  const { email, password, name } = req.validated.body;
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(409, "Email already registered");
  }

  const hashedPassword = await bcrypt.hash(password, config.bcryptSaltRounds);
  const user = await User.create({
    email,
    password: hashedPassword,
    name,
  });

  const tokens = await issueTokenPair(user.id);

  logger.info("auth.signup.success", { userId: user.id, email: user.email });
  return successResponse(
    res,
    "Signup successful",
    { user: user.toJSON(), ...tokens },
    201
  );
}

async function login(req, res) {
  const { email, password } = req.validated.body;
  const user = await User.findOne({ email });

  if (user && user.lockUntil && user.lockUntil > new Date()) {
    throw new ApiError(429, "Account temporarily locked due to failed login attempts");
  }

  const passwordHash = user ? user.password : DUMMY_PASSWORD_HASH;
  const isValidPassword = await bcrypt.compare(password, passwordHash);

  if (!user || !isValidPassword) {
    if (user) {
      user.loginAttempts += 1;
      if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + ACCOUNT_LOCK_MS);
        user.loginAttempts = 0;
      }
      await user.save();
    }

    throw new ApiError(401, "Invalid credentials");
  }

  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  const tokens = await issueTokenPair(user.id);
  logger.info("auth.login.success", { userId: user.id, email: user.email });

  return successResponse(res, "Login successful", {
    user: user.toJSON(),
    ...tokens,
  });
}

async function refreshToken(req, res) {
  const { refreshToken: inputToken } = req.validated.body;
  let decoded;

  try {
    decoded = verifyRefreshToken(inputToken);
  } catch (_err) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const tokenHash = hashToken(inputToken);
  const savedToken = await RefreshToken.findOne({
    userId: decoded.userId,
    tokenHash,
    revokedAt: null,
  });

  if (!savedToken) {
    throw new ApiError(401, "Refresh token revoked or not found");
  }

  if (savedToken.expiresAt < new Date()) {
    throw new ApiError(401, "Refresh token expired");
  }

  savedToken.revokedAt = new Date();
  await savedToken.save();

  const tokens = await issueTokenPair(decoded.userId);
  logger.info("auth.refresh.success", { userId: decoded.userId });
  return successResponse(res, "Token refreshed", tokens);
}

async function logout(req, res) {
  const { refreshToken: inputToken } = req.validated.body;
  const tokenHash = hashToken(inputToken);
  await RefreshToken.updateOne(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return successResponse(res, "Logged out successfully", null);
}

async function logoutAll(req, res) {
  await RefreshToken.updateMany(
    { userId: req.user.id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return successResponse(res, "Logged out from all devices", null);
}

module.exports = {
  signup,
  login,
  refreshToken,
  logout,
  logoutAll,
};
