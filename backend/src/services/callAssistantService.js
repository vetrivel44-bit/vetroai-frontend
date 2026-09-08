// Call Assistant pipeline — Phase 1 of the spec's build plan (§8): post-call
// analysis of a recording. No live audio injection, no auto-answer, no
// telephony permissions. Phases 2 and 3 are an Android app plus the legal work
// in §7; see docs/vetroai-call-assistant.md for what is deliberately not here.
//
// Every path out of this file goes through the call guard first. Transcribed
// text is redacted the moment it comes back from the recogniser, and both
// translation and speech synthesis re-check with assertSafeToTransmit() before
// they touch the network.

const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const callGuard = require("./callGuard");
const { redact } = require("./callGuard/redactor");

const ASR_MAX_BYTES = 25 * 1024 * 1024; // Groq's per-file limit for the audio endpoints
const TTS_MAX_CHARS = 900;

const groqClient = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;

class PipelineError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function capabilities() {
  return {
    transcription: {
      available: !!groqClient,
      provider: groqClient ? "groq" : null,
      model: config.callAsrModel,
      reason: groqClient ? null : "GROQ_API_KEY is not configured.",
    },
    translation: {
      available: !!groqClient,
      provider: groqClient ? "groq" : null,
      model: config.callTranslationModel,
      reason: groqClient ? null : "GROQ_API_KEY is not configured.",
    },
    speech: {
      available: !!config.googleTtsApiKey,
      provider: config.googleTtsApiKey ? "google-cloud-tts" : null,
      reason: config.googleTtsApiKey ? null : "GOOGLE_TTS_API_KEY is not configured.",
    },
    // Analysis is local: no key, no network, and it is the part that must keep
    // working when everything else is unconfigured or offline.
    analysis: { available: true, provider: "on-server rules" },
  };
}

/**
 * Transcribe a call recording and redact it before returning.
 *
 * The redaction happens here rather than in the caller so there is no window in
 * which an un-redacted transcript exists outside this function.
 */
async function transcribe({ buffer, filename, mimetype, language }) {
  if (!groqClient) {
    throw new PipelineError(501, "Speech-to-text is not configured. Set GROQ_API_KEY to enable call transcription.", "ASR_NOT_CONFIGURED");
  }
  if (!buffer?.length) {
    throw new PipelineError(400, "A call recording is required.", "AUDIO_REQUIRED");
  }
  if (buffer.length > ASR_MAX_BYTES) {
    throw new PipelineError(413, `Recording exceeds the ${Math.round(ASR_MAX_BYTES / (1024 * 1024))} MB limit for transcription.`, "AUDIO_TOO_LARGE");
  }

  const file = await Groq.toFile(buffer, filename || "call-recording.webm", { type: mimetype || "audio/webm" });
  let response;
  try {
    response = await groqClient.audio.transcriptions.create({
      file,
      model: config.callAsrModel,
      response_format: "verbose_json",
      // Omitted entirely when the user has not picked one, which is what makes
      // the recogniser auto-detect the language (spec §5.1).
      ...(language ? { language } : {}),
    });
  } catch (err) {
    logger.error("callAssistant.transcribe.failed", { error: err?.message, status: err?.status });
    throw new PipelineError(err?.status === 429 ? 429 : 502, err?.status === 429
      ? "The speech-to-text provider is rate limited. Try again in a moment."
      : "Could not transcribe this recording. Check the audio format and try again.", "ASR_FAILED");
  }

  const segments = Array.isArray(response?.segments) ? response.segments : [];
  const turns = segments.length
    ? segments.map((segment) => ({ text: String(segment.text || "").trim(), at: Number(segment.start) || 0 }))
    : [{ text: String(response?.text || "").trim(), at: 0 }];

  // Redact immediately. From this point on the raw transcript is unreachable.
  const redactedTurns = turns
    .filter((turn) => turn.text)
    .map((turn) => {
      const { text, entities } = redact(turn.text);
      return { text, at: turn.at, entityTypes: [...new Set(entities.map((e) => e.type))] };
    });

  const meta = {
    language: response?.language || language || "auto",
    duration: Number(response?.duration) || null,
    turnCount: redactedTurns.length,
    redactedCount: redactedTurns.reduce((sum, t) => sum + t.entityTypes.length, 0),
  };
  logger.info("callAssistant.transcribe.ok", meta);

  return { turns: redactedTurns, ...meta };
}

const LANGUAGE_NAMES = {
  en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", ml: "Malayalam", kn: "Kannada",
  mr: "Marathi", bn: "Bengali", gu: "Gujarati", pa: "Punjabi", ur: "Urdu",
  es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian",
  ar: "Arabic", zh: "Chinese (Mandarin)", ja: "Japanese", ko: "Korean", ru: "Russian",
  id: "Indonesian", vi: "Vietnamese", th: "Thai", tr: "Turkish", nl: "Dutch", pl: "Polish",
  fil: "Filipino", sw: "Swahili", he: "Hebrew", fa: "Persian",
};

const languageName = (code) => LANGUAGE_NAMES[String(code || "").toLowerCase().split("-")[0]] || code;

/**
 * Translate already-redacted call text.
 *
 * The system prompt is narrow on purpose. Spec §2 makes it an explicit non-goal
 * for the assistant to converse on the user's behalf: it translates, it does
 * not answer, agree, soften or advise.
 */
async function translate({ texts, targetLanguage, sourceLanguage }) {
  const items = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? ""));
  if (!items.some((t) => t.trim())) {
    throw new PipelineError(400, "Nothing to translate.", "TEXT_REQUIRED");
  }
  if (!targetLanguage) {
    throw new PipelineError(400, "A target language is required.", "TARGET_LANGUAGE_REQUIRED");
  }

  // The transmit gate runs before the provider check, so a refusal to send a
  // code never depends on how the deployment happens to be configured.
  items.forEach((text) => callGuard.assertSafeToTransmit(text, "the translation provider"));

  if (!groqClient) {
    throw new PipelineError(501, "Translation is not configured. Set GROQ_API_KEY to enable it.", "MT_NOT_CONFIGURED");
  }

  const system = [
    "You are a translation engine inside a phone-call assistant.",
    `Translate each numbered line into ${languageName(targetLanguage)}.`,
    sourceLanguage ? `The source language is ${languageName(sourceLanguage)}.` : "Detect the source language yourself.",
    "Rules:",
    "- Translate only. Never answer, advise, summarise, apologise or add anything.",
    "- Keep every [REDACTED:...] token exactly as it appears, in the same position. It marks a value that was deliberately withheld.",
    "- Preserve the speaker's tone, including rudeness or threats. Do not soften them.",
    "- Return one line per input line, numbered the same way, and nothing else.",
  ].join("\n");

  const numbered = items.map((text, i) => `${i + 1}. ${text}`).join("\n");

  let completion;
  try {
    completion = await groqClient.chat.completions.create({
      model: config.callTranslationModel,
      temperature: 0,
      max_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: numbered },
      ],
    });
  } catch (err) {
    logger.error("callAssistant.translate.failed", { error: err?.message, status: err?.status });
    throw new PipelineError(502, "The translation provider did not respond. Try again.", "MT_FAILED");
  }

  const raw = completion?.choices?.[0]?.message?.content || "";
  const byIndex = new Map();
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*(\d+)\s*[.)]\s*(.*)$/);
    if (match) byIndex.set(Number(match[1]), match[2].trim());
  }
  const translations = items.map((_, i) => byIndex.get(i + 1) ?? "");

  // A model can still echo something it should not have. Redact the output too.
  return {
    translations: translations.map((text) => redact(text).text),
    targetLanguage,
    model: config.callTranslationModel,
  };
}

// Google Cloud Text-to-Speech. Voice tiers are ordered by how natural they
// sound; the first tier Google actually offers for the requested language wins,
// so this keeps working as Google adds and retires voice families instead of
// hard-coding a voice name that quietly stops existing.
const VOICE_TIERS = ["Chirp3-HD", "Chirp-HD", "Chirp", "Neural2", "Studio", "Polyglot", "Wavenet", "Standard"];
const voiceCache = new Map();

async function pickVoice(languageCode) {
  if (voiceCache.has(languageCode)) return voiceCache.get(languageCode);

  const url = `https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(languageCode)}&key=${encodeURIComponent(config.googleTtsApiKey)}`;
  let voices = [];
  try {
    const response = await fetch(url);
    if (response.ok) {
      const body = await response.json();
      voices = Array.isArray(body?.voices) ? body.voices : [];
    }
  } catch (err) {
    logger.warn("callAssistant.tts.voiceList.failed", { error: err?.message, languageCode });
  }

  let chosen = null;
  for (const tier of VOICE_TIERS) {
    const match = voices.find((voice) => String(voice.name || "").includes(tier));
    if (match) {
      chosen = { name: match.name, languageCode: match.languageCodes?.[0] || languageCode };
      break;
    }
  }
  // No list, or nothing recognisable: let Google choose for the language.
  const result = chosen || { name: null, languageCode };
  voiceCache.set(languageCode, result);
  return result;
}

/**
 * Speak a line of call text with Google Cloud Text-to-Speech.
 *
 * Used for the spoken scam warning and for played-back translations, which is
 * why it refuses text that still carries sensitive values: the one thing this
 * feature must never do is read an OTP out loud.
 */
async function synthesize({ text, languageCode = "en-US", voiceName, speakingRate = 1.0 }) {
  const input = String(text || "").trim();
  if (!input) throw new PipelineError(400, "Nothing to speak.", "TEXT_REQUIRED");
  if (input.length > TTS_MAX_CHARS) {
    throw new PipelineError(413, `Text for speech must be ${TTS_MAX_CHARS} characters or fewer.`, "TEXT_TOO_LONG");
  }
  // Before the provider check: the assistant must never read a code out loud,
  // configured or not.
  callGuard.assertSafeToTransmit(input, "the speech provider");

  if (!config.googleTtsApiKey) {
    throw new PipelineError(501, "Google Cloud Text-to-Speech is not configured. Set GOOGLE_TTS_API_KEY to enable spoken output.", "TTS_NOT_CONFIGURED");
  }

  const voice = voiceName
    ? { name: voiceName, languageCode }
    : await pickVoice(languageCode);

  let response;
  try {
    response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(config.googleTtsApiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: input },
        voice: { languageCode: voice.languageCode, ...(voice.name ? { name: voice.name } : {}) },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate,
          // A warning that arrives late is useless, so the safety line is
          // deliberately not slowed down for "clarity".
          effectsProfileId: ["telephony-class-application"],
        },
      }),
    });
  } catch (err) {
    logger.error("callAssistant.tts.failed", { error: err?.message });
    throw new PipelineError(502, "Could not reach Google Text-to-Speech.", "TTS_FAILED");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logger.error("callAssistant.tts.rejected", { status: response.status, detail: detail.slice(0, 300) });
    throw new PipelineError(
      response.status === 403 ? 502 : 502,
      response.status === 403
        ? "Google Text-to-Speech rejected the API key. Check that the key is valid and the Text-to-Speech API is enabled for the project."
        : "Google Text-to-Speech returned an error.",
      "TTS_FAILED"
    );
  }

  const body = await response.json();
  if (!body?.audioContent) throw new PipelineError(502, "Google Text-to-Speech returned no audio.", "TTS_EMPTY");

  return {
    audioBase64: body.audioContent,
    mimeType: "audio/mpeg",
    voice: voice.name || `${voice.languageCode} (Google default)`,
    languageCode: voice.languageCode,
  };
}

module.exports = {
  PipelineError,
  capabilities,
  transcribe,
  translate,
  synthesize,
  LANGUAGE_NAMES,
  ASR_MAX_BYTES,
  TTS_MAX_CHARS,
};
