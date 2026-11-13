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
// { audios: [base64] }. Up to 2500 characters a request.
//
// Two Bulbul models. bulbul:v4-flash speaks as "personas", each recorded
// in a delivery style (companion, conversational, narration…): warm and
// expressive, like a person talking rather than reading. v3 has plain
// speakers whose expressiveness comes from `temperature`. A Premium voice
// uses its v4 persona where Sarvam has one for the language (English, Hindi,
// male Tamil), and v3 otherwise (Malayalam, Odia, female Tamil…) or if
// Sarvam turns the persona down.

const { config } = require("../config/env");
const logger = require("../utils/logger");

const ENDPOINT = "https://api.sarvam.ai/text-to-speech";
const PERSONA_MODEL = "bulbul:v4-flash";
const DEFAULT_MODEL = "bulbul:v3";
// v3's default is 0.6; higher reads with more feeling. v3 only speaks where
// no persona does (female Tamil, Malayalam, Odia), so it leans expressive.
const V3_TEMPERATURE = 0.85;
const MAX_CHARS = 2500;

// The picker's Premium voices. personas: language → the v4 persona of the
// same gender that talks most naturally in it (conversational or companion
// styles first, narration where a language has nothing else); v3: the plain
// speaker for the rest. Sarvam has no female Tamil persona, and none in
// Malayalam or Odia yet.
const VOICES = {
  "sarvam-aparna": { gender: "female", v3: "ishita", personas: {
    en: "aparna_en_companion", hi: "roopa_hi_conversational", te: "kavitha_te_conversation", kn: "chaitra_kn_conversation",
    bn: "roopa_bn_conversational", mr: "ishita_mr_conversational", gu: "pooja_gu_conversational", pa: "harpreet_pa_narration",
  } },
  "sarvam-sanchita": { gender: "female", v3: "priya", personas: {
    en: "sanchita_en_companion", hi: "kavya_hi_conversational", te: "pooja_te_conversation", kn: "chaitra_kn_conversation",
    bn: "roopa_bn_conversational", mr: "ritu_mr_narration", gu: "pooja_gu_conversational", pa: "harpreet_pa_narration",
  } },
  "sarvam-dev": { gender: "male", v3: "ratan", personas: {
    en: "dev_en_conversational", hi: "tarun_hi_conversational", ta: "gokul_ta_narration", te: "tarun_te_narration", kn: "chetan_kn_conversation",
    bn: "arnab_bn_conversation", mr: "nilesh_mr_conversation", gu: "bhavik_gu_conversation", pa: "anand_pa_conversation",
  } },
  "sarvam-shubh": { gender: "male", v3: "shubh", personas: {
    en: "shubh_en_narration_gentle", hi: "mani_hi_conversational", ta: "vijay_ta_narration", te: "tarun_te_narration", kn: "chetan_kn_conversation",
    bn: "arnab_bn_conversation", mr: "soham_mr_narration", gu: "bhavik_gu_conversation", pa: "anand_pa_conversation",
  } },
};
// The first Premium voices, kept working for anyone who picked one.
const RENAMED = { "sarvam-ishita": "sarvam-aparna", "sarvam-priya": "sarvam-sanchita", "sarvam-ratan": "sarvam-dev" };
// v3 speakers Sarvam rates best per language, for a female voice reading
// a language with no female persona.
const V3_FEMALE = { ta: "ritu", ml: "pooja", od: "ritu", bn: "roopa", pa: "roopa", te: "neha", kn: "neha", mr: "priya", gu: "priya" };

const isSarvamVoice = (voice) => String(voice || "").startsWith("sarvam-");

/** "sarvam-dev" (or its old name "sarvam-ratan") → its voice; an unknown "sarvam-…" id gets Aparna. */
const sarvamVoice = (voice) => {
  const id = RENAMED[String(voice || "")] || String(voice || "");
  return VOICES[id] || VOICES["sarvam-aparna"];
};

/** The v4 persona for `voice` in `code` ("en", "ta"…), or null to use v3. */
const personaFor = (voice, code) => sarvamVoice(voice).personas[code] || null;

/** The v3 speaker for `voice` in `code`. */
function v3SpeakerFor(voice, code) {
  const picked = sarvamVoice(voice);
  return picked.gender === "female" && V3_FEMALE[code] && picked.v3 === "priya" ? V3_FEMALE[code] : picked.v3;
}

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
  const code = languageCode.slice(0, 2);
  const common = {
    text: words,
    language_code: languageCode,
    pace: paceFor(rate),
    speech_sample_rate: 24000,
    // MP3 plays everywhere and is a tenth the size of Bulbul's default WAV.
    output_audio_codec: "mp3",
  };
  const v3 = { ...common, model: config.sarvamTtsModel || DEFAULT_MODEL, speaker: v3SpeakerFor(voice, code), temperature: V3_TEMPERATURE };
  const persona = personaFor(voice, code);
  const rejected = (err) => err?.status === 400 || err?.status === 422;
  let reply;
  let used = persona ? `${PERSONA_MODEL}/${persona}` : `${v3.model}/${v3.speaker}`;
  try {
    reply = await request(persona ? { ...common, model: PERSONA_MODEL, speaker: persona } : v3);
  } catch (err) {
    if (!rejected(err)) throw err;
    used = `${v3.model}/${v3.speaker}`;
    try {
      // A persona Sarvam turned down: the same voice on v3.
      if (persona) logger.warn("tts.sarvam.personaRejected", { persona, error: err?.message });
      reply = await request(v3);
    } catch (again) {
      // Older API versions named the language "target_language_code".
      if (!rejected(again)) throw again;
      const { language_code: target, ...rest } = v3;
      reply = await request({ ...rest, target_language_code: target });
    }
  }
  const encoded = Array.isArray(reply?.audios) ? reply.audios[0] : null;
  if (!encoded) throw new Error("Sarvam TTS returned no audio");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 200) throw new Error("Sarvam TTS returned no audio");
  // voice: the model and speaker that read it ("bulbul:v4-flash/aparna_en_companion").
  return { buffer, contentType: audioType(buffer), provider: "sarvam", voice: used };
}

module.exports = {
  synthesize,
  isSarvamVoice,
  sarvamVoice,
  personaFor,
  v3SpeakerFor,
  sarvamLanguage,
  paceFor,
  audioType,
  available,
  VOICES,
  // Tests stand in for Sarvam; returns the one it replaced.
  setRequester: (fn) => { const previous = request; request = fn; return previous; },
};
