// The composer's microphone: what the person said, as text for the message
// box.
//
// Dictation used to run on the browser's own speech recognition, which
// Firefox doesn't have, the desktop app can't reach (it needs Google's speech
// service, which only ships in Chrome) and which failed without a word in
// most other cases. The app now records the audio itself and sends it here,
// and Groq's Whisper writes it down in whatever language it was spoken.
//
// Any language: Whisper knows the hundred in LANGUAGES and works out which
// one it hears. The full model (whisper-large-v3) is the default: turbo is
// cheaper but noticeably weaker on Tamil, Telugu, Kannada, Malayalam and other
// languages with less training data. On a short clip Whisper can also pick a
// close neighbour of the language spoken: Hindi written in Urdu script, Tamil
// heard as Malayalam, Malay as Indonesian. The app sends the languages this
// person uses (`hints`); when Whisper's pick is a neighbour of one of them,
// or it isn't sure, the clip is heard again in that language and the more
// confident reading wins.
//
// Indian languages go to Sarvam (Saaras, made for them) when SARVAM_API_KEY
// is set: when the person picked Tamil, Hindi, Telugu, Kannada, Malayalam,
// Bengali, Marathi, Gujarati or Punjabi, when the language they type in is
// one of those, or when Whisper heard one of those and wasn't sure. Saaras's
// "codemix" mode writes Tanglish the way people type it: Tamil words in Tamil,
// English words in English. Whisper stays for every other language, and reads
// the clip if Sarvam fails.

const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const { isModelNotFound } = require("../utils/groqModel");

// Whisper's languages: ISO code → the name its replies use.
const LANGUAGES = {
  en: "english", zh: "chinese", de: "german", es: "spanish", ru: "russian", ko: "korean", fr: "french", ja: "japanese",
  pt: "portuguese", tr: "turkish", pl: "polish", ca: "catalan", nl: "dutch", ar: "arabic", sv: "swedish", it: "italian",
  id: "indonesian", hi: "hindi", fi: "finnish", vi: "vietnamese", he: "hebrew", uk: "ukrainian", el: "greek", ms: "malay",
  cs: "czech", ro: "romanian", da: "danish", hu: "hungarian", ta: "tamil", no: "norwegian", th: "thai", ur: "urdu",
  hr: "croatian", bg: "bulgarian", lt: "lithuanian", la: "latin", mi: "maori", ml: "malayalam", cy: "welsh", sk: "slovak",
  te: "telugu", fa: "persian", lv: "latvian", bn: "bengali", sr: "serbian", az: "azerbaijani", sl: "slovenian", kn: "kannada",
  et: "estonian", mk: "macedonian", br: "breton", eu: "basque", is: "icelandic", hy: "armenian", ne: "nepali", mn: "mongolian",
  bs: "bosnian", kk: "kazakh", sq: "albanian", sw: "swahili", gl: "galician", mr: "marathi", pa: "punjabi", si: "sinhala",
  km: "khmer", sn: "shona", yo: "yoruba", so: "somali", af: "afrikaans", oc: "occitan", ka: "georgian", be: "belarusian",
  tg: "tajik", sd: "sindhi", gu: "gujarati", am: "amharic", yi: "yiddish", lo: "lao", uz: "uzbek", fo: "faroese",
  ht: "haitian creole", ps: "pashto", tk: "turkmen", nn: "nynorsk", mt: "maltese", sa: "sanskrit", lb: "luxembourgish",
  my: "myanmar", bo: "tibetan", tl: "tagalog", mg: "malagasy", as: "assamese", tt: "tatar", haw: "hawaiian", ln: "lingala",
  ha: "hausa", ba: "bashkir", jv: "javanese", su: "sundanese", yue: "cantonese",
};
const BY_NAME = Object.fromEntries(Object.entries(LANGUAGES).map(([code, name]) => [name, code]));
// Other names Whisper and browsers use for the same languages.
Object.assign(BY_NAME, { burmese: "my", "haitian": "ht", filipino: "tl", "valencian": "ca", flemish: "nl", "moldavian": "ro", moldovan: "ro", castilian: "es", "panjabi": "pa", pushto: "ps", sinhalese: "si", "mandarin": "zh", "letzeburgesch": "lb" });

/** "Tamil", "tamil", "ta", "ta-IN", "fil" → "ta" / "tl"; null for anything else. */
function languageCode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (BY_NAME[raw]) return BY_NAME[raw];
  const base = raw.split(/[-_]/)[0];
  if (base === "fil") return "tl";
  if (base === "nb") return "no";
  if (base === "iw") return "he";
  return Object.hasOwn(LANGUAGES, base) ? base : null;
}

// Languages Whisper mixes up with each other on short clips.
const NEIGHBOURS = [
  ["hi", "ur", "mr", "ne", "pa", "sa"],
  ["ta", "ml", "si", "te", "kn"],
  ["bn", "as"],
  ["ms", "id", "jv", "su", "tl"],
  ["no", "nn", "da", "sv"],
  ["sr", "hr", "bs", "mk", "sl"],
  ["es", "gl", "ca", "pt"],
  ["zh", "yue"],
  ["ru", "uk", "be", "bg"],
  ["fa", "tg", "ps"],
  ["cs", "sk"],
  ["af", "nl"],
];
const areNeighbours = (a, b) => a !== b && NEIGHBOURS.some((group) => group.includes(a) && group.includes(b));

// Languages Whisper writes in a script other than the Latin alphabet.
const NON_LATIN = new Set([
  "zh", "yue", "ja", "ko", "ru", "uk", "be", "bg", "mk", "sr", "kk", "mn", "tg", "tt", "ba", "ar", "fa", "ur", "ps", "sd",
  "yi", "he", "hi", "mr", "ne", "sa", "bn", "as", "pa", "gu", "ta", "te", "kn", "ml", "si", "th", "lo", "km", "my", "bo",
  "ka", "hy", "am", "el",
]);
const isLatin = (code) => Boolean(code) && !NON_LATIN.has(code);

// Clips longer than this carry enough speech for Whisper to tell the language.
const RECHECK_MAX_SECONDS = 30;
// Below this average log-probability Whisper is guessing.
const UNSURE_LOGPROB = -0.75;
// Below this it isn't sure enough to overrule the language someone types in.
const FAIRLY_SURE_LOGPROB = -0.45;

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

/** Can recordings be typed out here? (A Groq or Sarvam key is set, or a test stands in.) */
let available = () => !!config.groqApiKey || sarvamAvailable();
const dictationAvailable = () => available();

// ── Sarvam (Indian languages) ───────────────────────────────────────────────

const SARVAM_ENDPOINT = "https://api.sarvam.ai/speech-to-text";
// The languages Sarvam types out instead of Whisper.
const INDIAN = new Set(["ta", "hi", "te", "kn", "ml", "bn", "mr", "gu", "pa"]);
const isIndian = (code) => INDIAN.has(code);

let sarvamAvailable = () => !!config.sarvamApiKey;

/**
 * Sends the audio to Sarvam; resolves to its reply ({ transcript,
 * language_code, language_probability, timestamps }). Tests replace it.
 * `language` is an ISO code ("ta"), or undefined to let Sarvam tell.
 */
let recogniseSarvam = async ({ buffer, filename, type, language }) => {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type }), filename);
  form.append("model", config.sarvamSttModel || "saaras:v3");
  form.append("mode", "codemix");
  form.append("language_code", language ? `${language}-IN` : "unknown");
  form.append("with_timestamps", "true");
  const res = await fetch(SARVAM_ENDPOINT, {
    method: "POST",
    headers: { "api-subscription-key": config.sarvamApiKey },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const err = new Error(`Sarvam speech-to-text returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
};

/** How long Sarvam heard speech for: the end of its last timestamped phrase. */
function sarvamDuration(reply) {
  const ends = reply?.timestamps?.end_time_seconds;
  const last = Array.isArray(ends) && ends.length ? Math.max(...ends.map(Number).filter(Number.isFinite)) : NaN;
  return Number.isFinite(last) && last > 0 ? Math.round(last * 100) / 100 : null;
}

/**
 * Sarvam's reading of the clip as { text, language, duration }, or null when
 * it failed or heard nothing (so Whisper's reading is used instead).
 */
async function hearSarvam(input) {
  if (!sarvamAvailable()) return null;
  try {
    const reply = await recogniseSarvam(input);
    const text = String(reply?.transcript || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    return { text, language: languageCode(reply?.language_code) || input.language || null, duration: sarvamDuration(reply) };
  } catch (err) {
    logger.warn("dictation.sarvam.failed", { error: err?.message, status: err?.status });
    return null;
  }
}

/** Should Sarvam hear this clip before Whisper? The Indian language to hear it in, or "" for Sarvam to tell. */
function sarvamFirst({ forced, hints }) {
  if (forced) return isIndian(forced) ? forced : null;
  return hints.length && isIndian(hints[0]) ? "" : null;
}

/** After Whisper: was it an Indian language Whisper wasn't sure of? */
const sarvamAfter = ({ detected, sureness }) => isIndian(detected) && (sureness === null || sureness < FAIRLY_SURE_LOGPROB);

// The model, then the others in case Groq retires one.
const modelsToTry = () => [...new Set([config.dictationAsrModel, "whisper-large-v3", "whisper-large-v3-turbo"].filter(Boolean))];
let workingModel = null;

/** Sends the audio to Whisper; resolves to its verbose_json reply. Tests replace it. */
let recognise = async ({ buffer, filename, type, language }) => {
  const groq = groqClient();
  if (!groq) throw new DictationError(501, "Voice typing isn't set up on this server yet.", "ASR_NOT_CONFIGURED");
  const models = workingModel ? [workingModel] : modelsToTry();
  let lastError;
  for (const model of models) {
    try {
      const file = await Groq.toFile(buffer, filename, { type });
      const reply = await groq.audio.transcriptions.create({
        file,
        model,
        response_format: "verbose_json",
        temperature: 0,
        // Left out unless known, so Whisper hears Tamil as Tamil and English
        // as English instead of being told what to expect.
        ...(language ? { language } : {}),
      });
      workingModel = model;
      return reply;
    } catch (err) {
      lastError = err;
      if (!isModelNotFound(err)) throw err;
      logger.warn("dictation.modelUnavailable", { model });
      if (workingModel) { workingModel = null; return recognise({ buffer, filename, type, language }); }
    }
  }
  throw lastError;
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
 * How sure Whisper was of a reading: its average log-probability, weighted
 * by how long each segment lasts. Higher is surer; null when it didn't say.
 */
function confidence(reply) {
  const segments = Array.isArray(reply?.segments) ? reply.segments.filter((s) => Number.isFinite(Number(s.avg_logprob))) : [];
  if (!segments.length) return null;
  let total = 0;
  let weight = 0;
  for (const s of segments) {
    const w = Math.max(0.1, (Number(s.end) || 0) - (Number(s.start) || 0));
    total += Number(s.avg_logprob) * w;
    weight += w;
  }
  return total / weight;
}

/** The person's languages, from the app: "ta,en" or ["ta", "en"] → ["ta", "en"]. */
function parseHints(hints) {
  const list = Array.isArray(hints) ? hints : String(hints || "").split(",");
  return [...new Set(list.map(languageCode).filter(Boolean))].slice(0, 4);
}

/**
 * Should a clip be heard again in one of the person's languages? Returns that
 * language, or null. Only short clips, and only when Whisper's pick isn't the
 * language they type in (hints[0]):
 * - a pick that isn't one of theirs: when it's a known neighbour of one of
 *   them, when Whisper was unsure, or when it's written in another script
 *   than the one they type in (English said with an Indian accent, heard as
 *   Tamil or Hindi and written in that script);
 * - a pick that is one of theirs, in another script than the one they type
 *   in: only when Whisper wasn't fairly sure.
 * The reading Whisper is surer of is kept, so a person who really spoke
 * Tamil still gets Tamil. (Forcing an unrelated language makes Whisper
 * translate, so it isn't done otherwise.)
 */
function recheckLanguage({ detected, hints, duration, sureness }) {
  if (!hints.length || !detected || detected === hints[0]) return null;
  if (Number(duration) > RECHECK_MAX_SECONDS) return null;
  const typed = hints[0];
  const otherScript = isLatin(typed) && !isLatin(detected);
  if (hints.includes(detected)) {
    return otherScript && sureness !== null && sureness < FAIRLY_SURE_LOGPROB ? typed : null;
  }
  const neighbour = hints.find((hint) => areNeighbours(hint, detected));
  if (neighbour) return neighbour;
  if (otherScript) return typed;
  return sureness !== null && sureness < UNSURE_LOGPROB ? typed : null;
}

async function hear(input) {
  try {
    return await recognise(input);
  } catch (err) {
    if (err instanceof DictationError) throw err;
    logger.warn("dictation.failed", { error: err?.message, status: err?.status });
    if (err?.status === 429) throw new DictationError(429, "Voice typing is busy right now. Try again in a moment.", "ASR_BUSY");
    throw new DictationError(502, "Couldn't make out that recording. Try again.", "ASR_FAILED");
  }
}

/**
 * Write down a voice recording, in whatever language it was spoken.
 * `language` forces one (rarely wanted); `hints` are the languages this
 * person uses, most likely first.
 * Resolves to { text, language, duration }; language is an ISO code, text ""
 * when nothing was said.
 */
async function transcribeDictation({ buffer, mimetype, language, hints } = {}) {
  if (!buffer?.length) throw new DictationError(400, "No audio was received.", "AUDIO_REQUIRED");
  if (buffer.length > MAX_BYTES) throw new DictationError(413, "That recording is too long to type out. Keep voice messages under about 10 minutes.", "AUDIO_TOO_LARGE");
  const type = baseType(mimetype) || "audio/webm";
  if (!isAudioType(type)) throw new DictationError(415, "That audio format isn't supported.", "AUDIO_FORMAT");
  const forced = languageCode(language) || undefined;
  const filename = `dictation.${EXTENSIONS[type]}`;
  const hinted = parseHints(hints);

  // An Indian language picked, or the one they type in: Sarvam first.
  const indian = sarvamFirst({ forced, hints: hinted });
  if (indian !== null) {
    const heard = await hearSarvam({ buffer, filename, type, language: indian || undefined });
    if (heard) return finish({ ...heard, language: forced || heard.language }, "sarvam");
  }

  let reply = await hear({ buffer, filename, type, language: forced });
  let lang = forced || languageCode(reply?.language);
  const sureness = confidence(reply);

  if (!forced) {
    const retry = recheckLanguage({ detected: lang, hints: hinted, duration: reply?.duration, sureness });
    if (retry) {
      const second = await hear({ buffer, filename, type, language: retry }).catch(() => null);
      const secondSureness = confidence(second);
      const better = second && spokenText(second) && (sureness === null || (secondSureness !== null && secondSureness > sureness));
      logger.info("dictation.recheck", { detected: lang, retry, sureness, secondSureness, kept: better ? retry : lang });
      if (better) { reply = second; lang = retry; }
    }
  }

  const whisper = { text: spokenText(reply), language: lang || null, duration: Number(reply?.duration) || null };

  // Whisper heard an Indian language but wasn't sure (and Sarvam didn't hear
  // it already): Sarvam's reading, when it makes one out.
  if (indian === null && whisper.text && sarvamAfter({ detected: lang, sureness })) {
    const heard = await hearSarvam({ buffer, filename, type });
    if (heard) return finish({ ...heard, duration: heard.duration || whisper.duration }, "sarvam");
  }
  return finish(whisper, "whisper");
}

function finish(result, by) {
  const shaped = { text: result.text, language: result.language || null, duration: Number(result.duration) || null };
  logger.info("dictation.ok", { chars: shaped.text.length, language: shaped.language, duration: shaped.duration, by });
  return shaped;
}

module.exports = {
  transcribeDictation,
  dictationAvailable,
  spokenText,
  languageCode,
  parseHints,
  recheckLanguage,
  confidence,
  LANGUAGES,
  isAudioType,
  baseType,
  DictationError,
  MAX_BYTES,
  sarvamFirst,
  sarvamAfter,
  // Tests stand in for Whisper and Sarvam.
  setRecogniser: (fn) => { recognise = fn; available = () => true; },
  setSarvamRecogniser: (fn) => {
    const previous = { recognise: recogniseSarvam, available: sarvamAvailable };
    recogniseSarvam = fn || previous.recognise;
    sarvamAvailable = fn ? () => true : () => false;
    return () => { recogniseSarvam = previous.recognise; sarvamAvailable = previous.available; };
  },
};
