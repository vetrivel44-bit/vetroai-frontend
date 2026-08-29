const express = require("express");
const multer = require("multer");
const router = express.Router();

const MAX_BYTES = 50 * 1024 * 1024;
const allowed = new Set(["audio/mpeg","audio/wav","audio/x-wav","audio/mp4","audio/x-m4a","audio/aac","audio/ogg","audio/flac","audio/webm"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => allowed.has(file.mimetype) ? cb(null, true) : cb(new Error("Unsupported audio format")),
});

const jsonError = (res, status, message, code) => res.status(status).json({ success:false, message, code });

// Custom voice creation is intentionally backend-only. Puter speech2speech accepts
// a target ElevenLabs voice ID but does not itself document creating a custom voice
// from user samples. Configure an authorized provider here; never expose its key.
router.post("/voices", upload.array("samples", 10), async (req, res) => {
  if (req.body.consent !== "true") return jsonError(res, 400, "Voice authorization consent is required.", "VOICE_CONSENT_REQUIRED");
  if (!req.files?.length) return jsonError(res, 400, "At least one voice sample is required.", "VOICE_SAMPLE_REQUIRED");
  if (!process.env.VOICE_PROFILE_PROVIDER_URL || !process.env.VOICE_PROFILE_PROVIDER_KEY) {
    return jsonError(res, 501, "Custom voice profile provider is not configured. Add a provider that supports authorized user-created voices and return its ElevenLabs-compatible voice ID.", "VOICE_PROVIDER_NOT_CONFIGURED");
  }
  return jsonError(res, 501, "Connect VOICE_PROFILE_PROVIDER_URL here using its documented multipart API. Provider-specific parameters are deliberately not invented.", "VOICE_PROVIDER_ADAPTER_REQUIRED");
});

// Stem separation must happen before voice conversion. This endpoint is the secure
// adapter for Demucs/UVR or a hosted separation service and must return two URLs.
router.post("/separate", upload.single("song"), async (req, res) => {
  if (!req.file) return jsonError(res, 400, "Song file is required.", "SONG_REQUIRED");
  if (!process.env.AUDIO_SEPARATOR_URL) {
    return jsonError(res, 501, "Audio stem separator is not configured. Configure AUDIO_SEPARATOR_URL for a Demucs/UVR-compatible service.", "SEPARATOR_NOT_CONFIGURED");
  }
  return jsonError(res, 501, "Connect AUDIO_SEPARATOR_URL using the separator service's documented request/response contract and return { vocalsUrl, instrumentalUrl }.", "SEPARATOR_ADAPTER_REQUIRED");
});

// Mixing/encoding is backend-only because production deployments should use FFmpeg
// (or a media service) to align, normalize and encode the two tracks reliably.
router.post("/mix", express.json({ limit: "1mb" }), async (req, res) => {
  const { instrumentalUrl, convertedVocalsUrl, outputFormat = "mp3" } = req.body || {};
  if (!instrumentalUrl || !convertedVocalsUrl) return jsonError(res, 400, "Both instrumental and converted vocal tracks are required.", "TRACKS_REQUIRED");
  if (!["mp3","wav"].includes(outputFormat)) return jsonError(res, 400, "Output format must be mp3 or wav.", "BAD_OUTPUT_FORMAT");
  if (!process.env.AUDIO_MIXER_URL) {
    return jsonError(res, 501, "Audio mixer is not configured. Configure AUDIO_MIXER_URL for an FFmpeg/media worker.", "MIXER_NOT_CONFIGURED");
  }
  return jsonError(res, 501, "Connect AUDIO_MIXER_URL using the media worker's documented API and return { url }.", "MIXER_ADAPTER_REQUIRED");
});

router.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") return jsonError(res, 413, "Audio file exceeds the 50 MB limit.", "FILE_TOO_LARGE");
  return jsonError(res, 400, err?.message || "Audio upload failed.", "AUDIO_UPLOAD_ERROR");
});

module.exports = router;
