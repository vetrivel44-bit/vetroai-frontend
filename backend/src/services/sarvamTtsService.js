"use strict";

// Sarvam AI's Bulbul voices (sarvam.ai): the "Premium" voices in the picker.
// Bulbul is made for Indian voices: Indian English sounds Indian, and the
// same speaker reads Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali,
// Marathi, Gujarati, Punjabi and Odia, so a reply that switches language
// keeps its voice. Needs SARVAM_API_KEY; without it (or if Sarvam fails)
// ttsService.js reads the text with the Edge voices instead.
//
// API: POST https://api.sarvam.ai/text-to-speech, header api-subscription-key,
// JSON { text, language_code, model, speaker, pace, output_audio_codec } →
// { audios: [base64] }. Up to 2500 characters a request on bulbul:v3.

const { config } = require("../config/env");

const ENDPOINT = "https://api.sarvam.ai/text-to-speech";
const DEFAULT_MODEL = "bulbul:v3";
const MAX_CHARS = 2500;

// The picker's Premium voices: id → Bulbul v3 speaker. The four Sarvam rates
// best across languages (its "Recommended speakers by language" table).
const VOICES = {
  "sarvam-ishita": { speaker: "ishita", gender: "female" },
  "sarvam-priya": { speaker: "priya", gender: "female" },
  "sarvam-ratan": { speaker: "ratan", gender: "male" },
  "sarvam-shubh": { speaker: "shubh", gender: "male" },
};

const isSarvamVoice = (voice) => String(voice || "").startsWith("sarvam-");

/** "sarvam-ratan" → its speaker and gender; an unknown "sarvam-…" id gets Ishita. */
const sarvamVoice = (voice) => VOICES[String(voice || "")] || VOICES["sarvam-ishita"];

// Bulbul's languages: the app's code → Sarvam's. ("or" is Odia's ISO code;
// Sarvam writes it "od".)
const LANGUAGES = {
  en: "en-IN", hi: "hi-IN", bn: "bn-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN",
  ml: "ml-IN", mr: "mr-IN", gu: "gu-IN", pa: "pa-IN", od: "od-IN", or: "od-IN",
};

// The script a reply is written in tells its language when the app didn't say.
const SCRIPTS = [
  [/[஀-௿]/, "ta"], [/[ఀ-౿]/, "te"], [/[ಀ-೿]/, "kn"],
  [/[ഀ-ൿ]/, "ml"], [/[ঀ-৿]/, "bn"], [/[઀-૿]/, "gu"],
  [/[਀-੿]/, "pa"], [/[଀-୿]/, "od"], [/[ऀ-ॿ]/, "hi"],
];

/**
 * Sarvam's language code for `text` in `lang` ("ta", "hi"…), or null when
 * Bulbul doesn't speak it. Without a language the script decides, and plain
 * Latin text is Indian English. (Devanagari is read as Hindi; Bulbul's
 * Marathi voice is only used when the app says "mr".)
 */
function sarvamLanguage(lang, text = "") {
  const code = String(lang || "").trim().toLowerCase().split(/[-_]/)[0];
  if (code) return LANGUAGES[code] || null;
  const script = SCRIPTS.find(([pattern]) => pattern.test(text));
  return LANGUAGES[script ? script[1] : "en"];
}

/** Edge's speaking speed ("+6%", "-10%") as Bulbul's pace (1.06, 0.9), within 0.5–2. */
function paceFor(rate) {
  const match = String(rate || "").match(/^([+-]\d{1,3})%$/);
  if (!match) return 1;
  return Math.min(2, Math.max(0.5, Math.round((1 + Number(match[1]) / 100) * 100) / 100));
}

/** What the audio is, from its first bytes: Sarvam's MP3 or, if it ignores the codec, WAV. */
function audioType(buffer) {
  const head = buffer.subarray(0, 4).toString("latin1");
  if (head === "RIFF") return "audio/wav";
  if (head.startsWith("ID3") || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (head === "fLaC") return "audio/flac";
  return "audio/mpeg";
}

/** Sends one request to Sarvam; resolves to its JSON reply. Tests replace it. */
let request = async (body, { timeoutMs = 20000 } = {}) => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": config.sarvamApiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    const err = new Error(`Sarvam TTS returned ${res.status}${detail ? `: ${detail}` : ""}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
};

const available = () => Boolean(config.sarvamApiKey);

/**
 * Speak `text` with a Premium voice.
 * @param {string} text
 * @param {{ voice?: string, lang?: string, rate?: string }} options
 * @returns {Promise<{ buffer: Buffer, contentType: string, provider: string }>}
 */
async function synthesize(text, { voice, lang, rate } = {}) {
  if (!available()) throw new Error("Sarvam isn't set up on this server (SARVAM_API_KEY).");
  const words = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!words) throw new Error("Nothing to speak.");
  const languageCode = sarvamLanguage(lang, words);
  if (!languageCode) throw new Error(`Sarvam doesn't speak "${lang}".`);
  const body = {
    text: words,
    language_code: languageCode,
    model: config.sarvamTtsModel || DEFAULT_MODEL,
    speaker: sarvamVoice(voice).speaker,
    pace: paceFor(rate),
    speech_sample_rate: 24000,
    // MP3 plays everywhere and is a tenth the size of Bulbul's default WAV.
    output_audio_codec: "mp3",
  };
  let reply;
  try {
    reply = await request(body);
  } catch (err) {
    // Older API versions named the language "target_language_code".
    if (err?.status !== 400 && err?.status !== 422) throw err;
    const { language_code: code, ...rest } = body;
    reply = await request({ ...rest, target_language_code: code });
  }
  const encoded = Array.isArray(reply?.audios) ? reply.audios[0] : null;
  if (!encoded) throw new Error("Sarvam TTS returned no audio");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 200) throw new Error("Sarvam TTS returned no audio");
  return { buffer, contentType: audioType(buffer), provider: "sarvam" };
}

module.exports = {
  synthesize,
  isSarvamVoice,
  sarvamVoice,
  sarvamLanguage,
  paceFor,
  audioType,
  available,
  VOICES,
  // Tests stand in for Sarvam; returns the one it replaced.
  setRequester: (fn) => { const previous = request; request = fn; return previous; },
};
