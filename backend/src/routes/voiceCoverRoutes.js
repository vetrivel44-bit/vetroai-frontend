const express = require("express");
const multer = require("multer");
const router = express.Router();

const MAX_BYTES = 50 * 1024 * 1024;
const allowed = new Set(["audio/mpeg","audio/wav","audio/x-wav","audio/mp4","audio/x-m4a","audio/aac","audio/ogg","audio/flac","audio/webm","audio/pcm","application/octet-stream"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => allowed.has(file.mimetype) ? cb(null, true) : cb(new Error("Unsupported audio format")),
});

const jsonError = (res, status, message, code) => res.status(status).json({ success:false, message, code });

// Custom voice creation stays backend-only. The configured provider must support
// authorized user-created voices. Never expose provider credentials to the browser.
router.post("/voices", upload.array("samples", 10), async (req, res) => {
  if (req.body.consent !== "true") return jsonError(res, 400, "Voice authorization consent is required.", "VOICE_CONSENT_REQUIRED");
  if (!req.files?.length) return jsonError(res, 400, "At least one voice sample is required.", "VOICE_SAMPLE_REQUIRED");
  if (!process.env.VOICE_PROFILE_PROVIDER_URL || !process.env.VOICE_PROFILE_PROVIDER_KEY) {
    return jsonError(res, 501, "Custom voice profile provider is not configured. Add a provider that supports authorized user-created voices and returns a compatible voice ID.", "VOICE_PROVIDER_NOT_CONFIGURED");
  }
  return jsonError(res, 501, "Connect VOICE_PROFILE_PROVIDER_URL using its documented multipart API. Provider-specific parameters are deliberately not invented.", "VOICE_PROVIDER_ADAPTER_REQUIRED");
});

// Stem separation always happens before voice conversion. The input must be audio
// the user owns or is licensed/permitted to process; this route does not download
// or rip recordings from streaming services based on a song title.
router.post("/separate", upload.single("song"), async (req, res) => {
  if (!req.file) return jsonError(res, 400, "Song file is required.", "SONG_REQUIRED");
  if (!process.env.AUDIO_SEPARATOR_URL) {
    return jsonError(res, 501, "Audio stem separator is not configured. Configure AUDIO_SEPARATOR_URL for a Demucs/UVR-compatible service.", "SEPARATOR_NOT_CONFIGURED");
  }
  return jsonError(res, 501, "Connect AUDIO_SEPARATOR_URL using the separator service's documented request/response contract and return { vocalsUrl, instrumentalUrl }.", "SEPARATOR_ADAPTER_REQUIRED");
});

// Puter may return a browser-local blob URL. A backend cannot fetch blob: URLs, so
// the frontend uploads the converted vocal bytes here as multipart instead.
router.post("/mix", upload.single("convertedVocals"), async (req, res) => {
  const { instrumentalUrl, outputFormat = "mp3" } = req.body || {};
  if (!instrumentalUrl || !req.file) return jsonError(res, 400, "Both the instrumental reference and converted vocal audio are required.", "TRACKS_REQUIRED");
  if (!["mp3","wav"].includes(outputFormat)) return jsonError(res, 400, "Output format must be mp3 or wav.", "BAD_OUTPUT_FORMAT");
  if (!process.env.AUDIO_MIXER_URL) {
    return jsonError(res, 501, "Audio mixer is not configured. Configure AUDIO_MIXER_URL for an FFmpeg/media worker.", "MIXER_NOT_CONFIGURED");
  }
  return jsonError(res, 501, "Connect AUDIO_MIXER_URL using its documented multipart API, sending the converted vocal bytes plus the instrumental reference, and return { url }.", "MIXER_ADAPTER_REQUIRED");
});

// One-shot pipeline used by the Voice Cover panel: separate the song into
// vocals/instrumental, build a voice profile from the reference sample,
// convert the vocals to that voice, then remix. Each stage requires its own
// provider; every provider is deliberately validated up front so a partially
// configured deployment fails fast with a specific, actionable error instead
// of a generic 404/500 partway through the pipeline.
router.post(
  "/process",
  upload.fields([
    { name: "song", maxCount: 1 },
    { name: "referenceVoice", maxCount: 1 },
  ]),
  async (req, res) => {
    const song = req.files?.song?.[0];
    const referenceVoice = req.files?.referenceVoice?.[0];
    const { outputFormat = "mp3", consent } = req.body || {};

    if (consent !== "true") return jsonError(res, 400, "Confirm that the reference recording is your voice or you have explicit permission to use it.", "VOICE_CONSENT_REQUIRED");
    if (!song) return jsonError(res, 400, "Upload the song audio you are permitted to process.", "SONG_REQUIRED");
    if (!referenceVoice) return jsonError(res, 400, "Record or upload your own voice first.", "VOICE_SAMPLE_REQUIRED");
    if (!["mp3", "wav"].includes(outputFormat)) return jsonError(res, 400, "Output format must be mp3 or wav.", "BAD_OUTPUT_FORMAT");

    if (!process.env.AUDIO_SEPARATOR_URL) {
      return jsonError(res, 501, "Audio stem separator is not configured. Configure AUDIO_SEPARATOR_URL for a Demucs/UVR-compatible service.", "SEPARATOR_NOT_CONFIGURED");
    }
    if (!process.env.VOICE_PROFILE_PROVIDER_URL || !process.env.VOICE_PROFILE_PROVIDER_KEY) {
      return jsonError(res, 501, "Custom voice profile provider is not configured. Add a provider that supports authorized user-created voices and returns a compatible voice ID.", "VOICE_PROVIDER_NOT_CONFIGURED");
    }
    if (!process.env.VOICE_CONVERSION_PROVIDER_URL) {
      return jsonError(res, 501, "Speech-to-speech voice conversion is not configured. Configure VOICE_CONVERSION_PROVIDER_URL for a singing voice conversion service.", "CONVERSION_NOT_CONFIGURED");
    }
    if (!process.env.AUDIO_MIXER_URL) {
      return jsonError(res, 501, "Audio mixer is not configured. Configure AUDIO_MIXER_URL for an FFmpeg/media worker.", "MIXER_NOT_CONFIGURED");
    }

    return jsonError(res, 501, "Connect the configured separator, voice profile, conversion and mixer providers using their documented APIs to complete the pipeline. Provider-specific parameters are deliberately not invented.", "PIPELINE_ADAPTER_REQUIRED");
  }
);

router.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") return jsonError(res, 413, "Audio file exceeds the 50 MB limit.", "FILE_TOO_LARGE");
  return jsonError(res, 400, err?.message || "Audio upload failed.", "AUDIO_UPLOAD_ERROR");
});

module.exports = router;
