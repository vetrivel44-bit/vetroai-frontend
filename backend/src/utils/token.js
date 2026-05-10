const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { config } = require("../config/env");

function getAccessSecret() { return config.jwtSecret || process.env.JWT_SECRET || "vetroai_dev_secret_fallback_2024"; }
function getRefreshSecret() { return config.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET || "vetroai_dev_refresh_fallback_2024"; }

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
