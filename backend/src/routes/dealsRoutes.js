const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { chatLimiter } = require("../middleware/rateLimiters");
const { searchDeals, featured } = require("../controllers/dealsController");

const router = express.Router();

router.get("/search", chatLimiter, asyncHandler(searchDeals));
router.get("/featured", chatLimiter, asyncHandler(featured));

module.exports = router;
