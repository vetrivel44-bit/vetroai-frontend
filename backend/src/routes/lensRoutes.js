const express = require("express");
const rateLimit = require("express-rate-limit");
const asyncHandler = require("../middleware/asyncHandler");
const providerManager = require("../services/ProviderManager");
const AIOrchestrator = require("../services/AIOrchestrator");
const { readAndTranslate, LensError } = require("../services/lensService");
const { successResponse, errorResponse } = require("../utils/response");
const logger = require("../utils/logger");

// POST /api/lens { image: "data:image/jpeg;base64,…", target: "ta" }
// Camera translate (lensService.js): replies { language, text, translation,
// explanation, target, targetName }. Mounted before the app's 1 MB JSON
// parser, with its own room for a photo.
const router = express.Router();

// The vision models, best first: the same order chat uses for pictures.
const VISION_ORDER = ["gemini", "cohere", "groq"];

const lensLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) => errorResponse(res, "Too many photos at once. Wait a moment and try again.", 429, { code: "RATE_LIMITED" }),
});

router.post("/", lensLimiter, express.json({ limit: "9mb" }), asyncHandler(async (req, res) => {
  const available = providerManager.getAvailableProviders();
  const providers = VISION_ORDER.filter((name) => available.includes(name));
  try {
    const result = await readAndTranslate({
      image: req.body?.image,
      target: String(req.body?.target || "en").slice(0, 8),
      providers,
      ask: (name, messages) => AIOrchestrator.askQuietly(name, messages, { maxTokens: 1600, temperature: 0.1 }),
    });
    return successResponse(res, "Read", result);
  } catch (err) {
    if (err instanceof LensError) {
      if (err.statusCode >= 500) logger.warn("lens.failed", { code: err.code, providers });
      return errorResponse(res, err.message, err.statusCode, { code: err.code });
    }
    throw err;
  }
}));

router.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large") return errorResponse(res, "That photo is too large. Try again a little further away.", 413, { code: "IMAGE_TOO_LARGE" });
  return errorResponse(res, "The photo didn't upload. Try again.", 400, { code: "UPLOAD_ERROR" });
});

module.exports = router;
