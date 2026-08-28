const express = require("express");
const { latestNews, footballFixtures } = require("../controllers/externalDataController");

const router = express.Router();

router.get("/news/latest", latestNews);
router.get("/football/fixtures", footballFixtures);

module.exports = router;
