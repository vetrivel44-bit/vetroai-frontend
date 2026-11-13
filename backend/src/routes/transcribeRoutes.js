// POST /api/transcribe: the composer's microphone (dictationService.js).
// POST: a multipart upload with the recording in "audio" and, optionally,
// the spoken language in "language". Replies { text, language, duration }.

const express = require("express");
const multer = require("multer");

const asyncHandler = require("../middleware/asyncHandler");
const { dictationLimiter } = require("../middleware/rateLimiters");
const { transcribeDictation, dictationAvailable, isAudioType, DictationError, MAX_BYTES } = require("../services/dictationService");
const { successResponse, errorResponse } = require("../utils/response");

const router = express.Router();

// Held in memory for the length of the request; nothing is written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 4 },
  fileFilter: (_req, file, cb) => {
    if (isAudioType(file.mimetype)) return cb(null, true);
    cb(new DictationError(415, "That audio format isn't supported.", "AUDIO_FORMAT"));
  },
});

// Whether the server can type out recordings, so the app can use the
// browser's own speech recognition instead when it can't.
router.get("/", (_req, res) => successResponse(res, "Dictation", { available: dictationAvailable() }));

router.post("/", dictationLimiter, upload.single("audio"), asyncHandler(async (req, res) => {
  try {
    const result = await transcribeDictation({
      buffer: req.file?.buffer,
      mimetype: req.file?.mimetype,
      language: req.body?.language,
    });
    return successResponse(res, result.text ? "Transcribed" : "No speech heard", result);
  } catch (err) {
    if (err instanceof DictationError) return errorResponse(res, err.message, err.statusCode, { code: err.code });
    throw err;
  }
}));

router.use((err, _req, res, _next) => {
  if (err instanceof DictationError) return errorResponse(res, err.message, err.statusCode, { code: err.code });
  if (err?.code === "LIMIT_FILE_SIZE") {
    return errorResponse(res, "That recording is too long to type out. Keep voice messages under about 10 minutes.", 413, { code: "AUDIO_TOO_LARGE" });
  }
  return errorResponse(res, "The recording didn't upload. Try again.", 400, { code: "AUDIO_UPLOAD_ERROR" });
});

module.exports = router;
