const rateLimit = require("express-rate-limit");
const { errorResponse } = require("../utils/response");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => errorResponse(res, "Too many auth attempts. Please try again later.", 429),
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }, // Disable on Render (proxy handled by platform)
  handler: (_req, res) => errorResponse(res, "Too many chat requests. Please slow down.", 429),
});

// Call Assistant. Transcription is the expensive call here, and a person
// analysing their own call recordings does it a handful of times, not dozens.
const callAssistantLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) => errorResponse(res, "Too many call assistant requests. Please slow down.", 429),
});

module.exports = {
  authLimiter,
  chatLimiter,
  callAssistantLimiter,
};
