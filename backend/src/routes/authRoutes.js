const express = require("express");
const authController = require("../controllers/authController");
const validate = require("../middleware/validate");
const authMiddleware = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimiters");
const {
  signupSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
} = require("../validators/authValidators");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.post("/signup", authLimiter, validate(signupSchema), asyncHandler(authController.signup));
router.post("/login", authLimiter, validate(loginSchema), asyncHandler(authController.login));
router.post("/refresh-token", validate(refreshTokenSchema), asyncHandler(authController.refreshToken));
router.post("/logout", validate(logoutSchema), asyncHandler(authController.logout));
router.post("/logout-all", authMiddleware, asyncHandler(authController.logoutAll));

module.exports = router;
