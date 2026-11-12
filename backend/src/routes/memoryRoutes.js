const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { chatLimiter } = require("../middleware/rateLimiters");
const memoryController = require("../controllers/memoryController");

const router = express.Router();

router.post("/extract", chatLimiter, asyncHandler(memoryController.extractMemories));

module.exports = router;
