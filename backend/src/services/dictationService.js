// The composer's microphone: what the person said, as text for the message
// box.
//
// Dictation used to run on the browser's own speech recognition, which
// Firefox doesn't have, the desktop app can't reach (it needs Google's speech
// service, which only ships in Chrome) and which failed without a word in
// most other cases. The app now records the audio itself and sends it here,
// the way Claude's and ChatGPT's apps do, and Groq's Whisper writes it down
// in whatever language it was spoken.

const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");

const MAX_BYTES = 25 * 1024 * 1024; // Groq's per-file limit for audio

// The containers browsers record in, and the file name Whisper reads the
// format from.
const EXTENSIONS = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mp4": "mp4",
  "video/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
};

/** "audio/webm;codecs=opus" → "audio/webm". */
const baseType = (mimetype) => String(mimetype || "").split(";")[0].trim().toLowerCase();

const isAudioType = (mimetype) => Object.hasOwn(EXTENSIONS, baseType(mimetype));

class DictationError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

let client = null;
let clientKey = null;
function groqClient() {
  if (!config.groqApiKey) return null;
  if (!client || clientKey !== config.groqApiKey) {
    client = new Groq({ apiKey: config.groqApiKey });
    clientKey = config.groqApiKey;
  }
  return client;
}

/** Can recordings be typed out here? (A Groq key is set, or a test stands in.) */
let available = () => !!config.groqApiKey;
const dictationAvailable = () => available();

/** Sends the audio to Whisper; resolves to its verbose_json reply. Tests replace it. */
let recognise = async ({ buffer, filename, type, language }) => {
  const groq = groqClient();
  if (!groq) throw new DictationError(501, "Voice typing isn't set up on this server yet.", "ASR_NOT_CONFIGURED");
  const file = await Groq.toFile(buffer, filename, { type });
  return groq.audio.transcriptions.create({
    file,
    model: config.dictationAsrModel,
    response_format: "verbose_json",
    temperature: 0,
    // Left out unless the person chose one, so Whisper hears Tamil as Tamil
    // and English as English instead of being told what to expect.
    ...(language ? { language } : {}),
  });
};

// On silence or room noise Whisper writes something anyway, usually one of
// these. Kept out only when Whisper itself doubts there was speech, so a
// person who really says "thank you" still gets it typed.
const PHANTOM = /^(?:thank you|thanks for watching|thank you for watching|thanks|you|bye|okay|\.+)[.!\s]*$/i;

/**
 * The words in Whisper's reply, without the segments it wrote over silence.
 * Its own rule: a segment it thinks is probably not speech (no_speech_prob
 * above 0.6) and isn't sure of (avg_logprob below -1) is dropped.
 */
function spokenText(reply) {
  const segments = Array.isArray(reply?.segments) ? reply.segments : null;
  if (!segments) return String(reply?.text || "").trim();
  const kept = segments.filter((s) => !(Number(s.no_speech_prob) > 0.6 && Number(s.avg_logprob) < -1));
  const text = kept.map((s) => String(s.text || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const doubtful = kept.some((s) => Number(s.no_speech_prob) > 0.2);
  if (PHANTOM.test(text) && doubtful) return "";
  return text;
}

/**
 * Write down a short voice recording.
 * Resolves to { text, language, duration }; text is "" when nothing was said.
 */
async function transcribeDictation({ buffer, mimetype, language } = {}) {
  if (!buffer?.length) throw new DictationError(400, "No audio was received.", "AUDIO_REQUIRED");
  if (buffer.length > MAX_BYTES) throw new DictationError(413, "That recording is too long to type out. Keep voice messages under about 10 minutes.", "AUDIO_TOO_LARGE");
  const type = baseType(mimetype) || "audio/webm";
  if (!isAudioType(type)) throw new DictationError(415, "That audio format isn't supported.", "AUDIO_FORMAT");
  const lang = /^[a-z]{2,3}$/i.test(String(language || "")) ? String(language).toLowerCase() : undefined;

  let reply;
  try {
    reply = await recognise({ buffer, filename: `dictation.${EXTENSIONS[type]}`, type, language: lang });
  } catch (err) {
    if (err instanceof DictationError) throw err;
    logger.warn("dictation.failed", { error: err?.message, status: err?.status });
    if (err?.status === 429) throw new DictationError(429, "Voice typing is busy right now. Try again in a moment.", "ASR_BUSY");
    throw new DictationError(502, "Couldn't make out that recording. Try again.", "ASR_FAILED");
  }

  const text = spokenText(reply);
  const result = {
    text,
    language: reply?.language || lang || null,
    duration: Number(reply?.duration) || null,
  };
  logger.info("dictation.ok", { chars: text.length, language: result.language, duration: result.duration });
  return result;
}

module.exports = {
  transcribeDictation,
  dictationAvailable,
  spokenText,
  isAudioType,
  baseType,
  DictationError,
  MAX_BYTES,
  // Tests stand in for Whisper.
  setRecogniser: (fn) => { recognise = fn; available = () => true; },
};
