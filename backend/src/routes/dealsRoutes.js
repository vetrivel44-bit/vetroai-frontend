const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { chatLimiter, previewImageLimiter } = require("../middleware/rateLimiters");
const { searchDeals, featured, productImage } = require("../controllers/dealsController");

const router = express.Router();

router.get("/search", chatLimiter, asyncHandler(searchDeals));
router.get("/featured", chatLimiter, asyncHandler(featured));
router.get("/image", previewImageLimiter, asyncHandler(productImage));

module.exports = router;
