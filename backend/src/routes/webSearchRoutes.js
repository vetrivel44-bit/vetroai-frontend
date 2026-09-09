const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { chatLimiter } = require("../middleware/rateLimiters");
const webSearchController = require("../controllers/webSearchController");

const router = express.Router();

router.post("/", chatLimiter, asyncHandler(webSearchController.performStructuredSearch));
router.post("/images", chatLimiter, asyncHandler(webSearchController.performStructuredImageSearch));

module.exports = router;