const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const optionalAuth = require("../middleware/optionalAuth");
const { chatLimiter } = require("../middleware/rateLimiters");
const usageController = require("../controllers/usageController");

const router = express.Router();

router.get("/", optionalAuth, asyncHandler(usageController.getUsage));
router.post("/consume", chatLimiter, optionalAuth, asyncHandler(usageController.consume));
router.post("/check", chatLimiter, optionalAuth, asyncHandler(usageController.checkModel));
router.post("/record", chatLimiter, optionalAuth, asyncHandler(usageController.recordModel));

module.exports = router;
