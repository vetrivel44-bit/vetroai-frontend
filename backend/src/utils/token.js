const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { config } = require("../config/env");

function requireSecret(value, name) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function getAccessSecret() {
  return requireSecret(config.jwtSecret || process.env.JWT_SECRET, "JWT_SECRET");
}

function getRefreshSecret() {
  return requireSecret(
    config.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET,
    "JWT_REFRESH_SECRET"
  );
}

function signAccessToken(userId) {
  return jwt.sign({ userId }, getAccessSecret(), {
    expiresIn: config.jwtAccessExpiresIn || "15m",
  });
}

function signRefreshToken(userId) {
  return jwt.sign({ userId }, getRefreshSecret(), {
    expiresIn: config.jwtRefreshExpiresIn || "7d",
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, getAccessSecret());
}

function verifyRefreshToken(token) {
  return jwt.verify(token, getRefreshSecret());
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
};
