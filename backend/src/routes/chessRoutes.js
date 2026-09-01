const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { chatLimiter } = require("../middleware/rateLimiters");
const { chessMove, getChessProviders } = require("../controllers/chessMoveController");

const router = express.Router();

router.post("/move", chatLimiter, asyncHandler(chessMove));
router.get("/providers", asyncHandler(getChessProviders));

module.exports = router;
