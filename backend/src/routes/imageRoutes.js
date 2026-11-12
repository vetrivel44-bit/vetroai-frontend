const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { chatLimiter } = require("../middleware/rateLimiters");
const airouterImage = require("../providers/airouterImage");

// POST /api/image/generate { prompt }          → { image, model }
// POST /api/image/edit     { prompt, images[] } → { image, model }
// Both use Gemini 3.1 Flash Lite Image on AI Router; image is a data URL.
const router = express.Router();

router.post("/generate", chatLimiter, asyncHandler(async (req, res) => {
  const image = await airouterImage.generateImage(req.body?.prompt);
  res.json({ image, model: airouterImage.imageModel() });
}));

router.post("/edit", chatLimiter, asyncHandler(async (req, res) => {
  const image = await airouterImage.editImage(req.body?.prompt, req.body?.images);
  res.json({ image, model: airouterImage.imageModel() });
}));

module.exports = router;
