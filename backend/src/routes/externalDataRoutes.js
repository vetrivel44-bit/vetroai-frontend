const express = require("express");
const { latestNews, footballFixtures, newsPreviewImage } = require("../controllers/externalDataController");
const { previewImageLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.get("/news/latest", latestNews);
router.get("/news/preview-image", previewImageLimiter, newsPreviewImage);
router.get("/football/fixtures", footballFixtures);

module.exports = router;
