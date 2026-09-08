// HTTP surface for the Call Assistant (spec §8 Phase 1).
//
// Nothing here persists a transcript. The analysis is computed, returned to the
// caller and dropped; the only copy that survives the request is the redacted
// one the browser keeps locally, which is what spec §5.4 asks for.

const asyncHandler = require("../middleware/asyncHandler");
const { successResponse, errorResponse } = require("../utils/response");
const logger = require("../utils/logger");
const callGuard = require("../services/callGuard");
const service = require("../services/callAssistantService");

const MAX_TURNS = 400;
const MAX_TURN_CHARS = 4000;

function fail(res, err, fallbackMessage) {
  const status = err?.statusCode || 500;
  if (status >= 500) logger.error("callAssistant.error", { code: err?.code, error: err?.message });
  return errorResponse(res, err?.message || fallbackMessage, status, err?.code ? { code: err.code } : null);
}

function normalizeTurns(input) {
  if (!Array.isArray(input)) return null;
  return input
    .slice(0, MAX_TURNS)
    .map((turn) => ({
      text: String(turn?.text ?? "").slice(0, MAX_TURN_CHARS),
      speaker: turn?.speaker === "user" ? "user" : "caller",
      at: turn?.at ?? null,
    }))
    .filter((turn) => turn.text.trim());
}

// GET /api/call-assistant/config
// Which parts of the pipeline are actually usable on this deployment, so the
// UI can say so instead of failing on the first click.
const getConfig = asyncHandler(async (_req, res) => {
  return successResponse(res, "Call assistant configuration", {
    phase: 1,
    mode: "post-call-analysis",
    capabilities: service.capabilities(),
    languages: service.LANGUAGE_NAMES,
    limits: { maxTurns: MAX_TURNS, maxTurnChars: MAX_TURN_CHARS, maxAudioBytes: service.ASR_MAX_BYTES, maxSpeechChars: service.TTS_MAX_CHARS },
  });
});

// POST /api/call-assistant/analyze
// Pure local analysis: rules and redaction only, no provider, no network. This
// keeps working when no API key is configured at all.
const analyze = asyncHandler(async (req, res) => {
  const turns = normalizeTurns(req.body?.turns);
  if (!turns?.length) {
    return errorResponse(res, "Provide the call transcript as turns: [{ speaker, text }].", 400, { code: "TURNS_REQUIRED" });
  }

  const analysis = callGuard.analyzeTranscript({
    turns,
    callerNumber: req.body?.callerNumber || "",
    callerReputation: req.body?.callerReputation || null,
  });

  logger.info("callAssistant.analyze", callGuard.safeLogMeta(analysis));
  return successResponse(res, "Call analysed", analysis);
});

// POST /api/call-assistant/transcribe  (multipart: recording)
// The response is already redacted and already analysed — there is no endpoint
// that returns a raw transcript.
const transcribe = asyncHandler(async (req, res) => {
  try {
    const result = await service.transcribe({
      buffer: req.file?.buffer,
      filename: req.file?.originalname,
      mimetype: req.file?.mimetype,
      language: req.body?.language || "",
    });

    // Speaker separation is not available from the recogniser, so every turn
    // starts attributed to the caller and the user re-assigns their own lines
    // in the UI. Analysis runs again on whatever attribution is in force.
    const speaker = req.body?.speaker === "user" ? "user" : "caller";
    const analysis = callGuard.analyzeTranscript({
      turns: result.turns.map((turn) => ({ ...turn, speaker })),
      callerNumber: req.body?.callerNumber || "",
    });

    logger.info("callAssistant.transcribe.analysed", callGuard.safeLogMeta(analysis));
    return successResponse(res, "Recording transcribed", {
      language: result.language,
      duration: result.duration,
      speakerSeparation: false,
      analysis,
    });
  } catch (err) {
    return fail(res, err, "Transcription failed.");
  }
});

// POST /api/call-assistant/translate
const translate = asyncHandler(async (req, res) => {
  try {
    const result = await service.translate({
      texts: req.body?.texts ?? req.body?.text,
      targetLanguage: req.body?.targetLanguage,
      sourceLanguage: req.body?.sourceLanguage,
    });
    return successResponse(res, "Translated", result);
  } catch (err) {
    return fail(res, err, "Translation failed.");
  }
});

// POST /api/call-assistant/speak
const speak = asyncHandler(async (req, res) => {
  try {
    const result = await service.synthesize({
      text: req.body?.text,
      languageCode: req.body?.languageCode || "en-US",
      voiceName: req.body?.voiceName,
      speakingRate: Number(req.body?.speakingRate) || 1.0,
    });
    return successResponse(res, "Speech generated", result);
  } catch (err) {
    return fail(res, err, "Speech synthesis failed.");
  }
});

module.exports = { getConfig, analyze, transcribe, translate, speak };
