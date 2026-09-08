const express = require("express");
const multer = require("multer");

const controller = require("../controllers/callAssistantController");
const { callAssistantLimiter } = require("../middleware/rateLimiters");
const { ASR_MAX_BYTES } = require("../services/callAssistantService");
const { errorResponse } = require("../utils/response");

const router = express.Router();

const ALLOWED_AUDIO = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a",
  "audio/aac", "audio/ogg", "audio/flac", "audio/webm", "video/mp4", "application/octet-stream",
]);

// Recordings stay in memory for the length of the request. Writing a call
// recording to disk would create exactly the retained copy spec §6 rules out.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ASR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) =>
    ALLOWED_AUDIO.has(file.mimetype) ? cb(null, true) : cb(new Error("Unsupported audio format.")),
});

router.use(callAssistantLimiter);

router.get("/config", controller.getConfig);
router.post("/analyze", controller.analyze);
router.post("/transcribe", upload.single("recording"), controller.transcribe);
router.post("/translate", controller.translate);
router.post("/speak", controller.speak);

router.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return errorResponse(res, `Recording exceeds the ${Math.round(ASR_MAX_BYTES / (1024 * 1024))} MB limit.`, 413, { code: "FILE_TOO_LARGE" });
  }
  return errorResponse(res, err?.message || "Call recording upload failed.", 400, { code: "AUDIO_UPLOAD_ERROR" });
});

module.exports = router;
