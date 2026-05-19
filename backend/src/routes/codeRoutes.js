const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const codeController = require("../controllers/codeController");
const { chatLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

// Apply chatLimiter or a dedicated rate limiter for code execution
router.post("/execute", chatLimiter, asyncHandler(codeController.executeCode));

module.exports = router;
