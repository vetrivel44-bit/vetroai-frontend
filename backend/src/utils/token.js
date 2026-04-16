const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { config } = require("../config/env");

function signAccessToken(userId) {
  return jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: config.jwtAccessExpiresIn,
  });
}

function signRefreshToken(userId) {
  return jwt.sign({ userId }, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiresIn,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwtRefreshSecret);
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
