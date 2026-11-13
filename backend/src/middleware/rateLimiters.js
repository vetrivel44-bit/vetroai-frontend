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

// News card photos. A feed page asks for at most a couple of dozen.
const previewImageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) => errorResponse(res, "Too many image lookups. Please slow down.", 429),
});

// The composer's microphone. One request per dictated message; a person
// talking instead of typing sends a few a minute at most.
const dictationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) => errorResponse(res, "Too many voice messages at once. Wait a moment and try again.", 429, { code: "RATE_LIMITED" }),
});

// VetroAI's voice (/api/tts): Read aloud and voice mode ask for one clip per
// few sentences. It used to share the chat limit, so reading a long reply
// (or reading one right after chatting) ran out of requests part way and the
// rest was read by the browser's robotic voice. Its own allowance, sized for
// a minute of non-stop listening with room to spare.
const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) => errorResponse(res, "Too many voice requests. Wait a moment and try again.", 429, { code: "RATE_LIMITED" }),
});

module.exports = {
  ttsLimiter,
  dictationLimiter,
  previewImageLimiter,
  authLimiter,
  chatLimiter,
  callAssistantLimiter,
};
