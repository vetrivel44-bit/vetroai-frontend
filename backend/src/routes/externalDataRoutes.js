const express = require("express");
const { latestNews, footballFixtures, newsPreviewImage } = require("../controllers/externalDataController");
const { previewImageLimiter, chatLimiter } = require("../middleware/rateLimiters");
const { astrologyContext } = require("../controllers/astrologyController");

const router = express.Router();

router.get("/news/latest", latestNews);
router.get("/news/preview-image", previewImageLimiter, newsPreviewImage);
router.post("/astrology/context", chatLimiter, astrologyContext);
router.get("/football/fixtures", footballFixtures);

module.exports = router;
