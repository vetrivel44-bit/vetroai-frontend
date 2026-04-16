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
