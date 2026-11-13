"use strict";

// One text-to-speech entry point for chat voice mode, news and narration.
// Everything here is free:
//   • "…Neural" voices (Jenny, Aria, Guy, Sonia, Ryan, Neerja…) → Microsoft
//     Edge's free neural voices, so each picker option really sounds different.
//   • "google-<lang>" voices → Google's free voice with that accent.
// Each falls back to the other, then (only if their keys are ever set) to
// Google Cloud TTS or RapidAPI. The browser's own voice is the last resort,
// in the frontend.

const { config } = require("../config/env");
const logger = require("../utils/logger");
const freeTts = require("./freeTtsService");
const edgeTts = require("./edgeTtsService");
const { nativeVoiceFor } = require("./ttsLanguage");

/** "en-GB-SoniaNeural" / "google-en-IN" / "hi-IN" → "en-GB" / "en-IN" / "hi-IN" */
const voiceLanguage = (voice) => {
  const match = String(voice || "").replace(/^google-/, "").match(/^([a-z]{2,3}-[A-Z]{2})/);
  return match ? match[1] : "en-US";
};

async function googleCloud(text, languageCode) {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(config.googleTtsApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: { text }, voice: { languageCode }, audioConfig: { audioEncoding: "MP3" } }),
  });
  if (!res.ok) throw new Error(`Google Cloud TTS returned ${res.status}`);
  const body = await res.json();
  if (!body?.audioContent) throw new Error("Google Cloud TTS returned no audio");
  return { buffer: Buffer.from(body.audioContent, "base64"), contentType: "audio/mpeg", provider: "google-cloud" };
}

// rate: speaking speed for Edge voices ("+6%"), as voice mode talks.
async function synthesizeSpeech({ text, voice, languageCode, lang: textLang, rate }) {
  const requested = String(voice || "en-US-AvaMultilingualNeural");
  // Text in another language than the picked voice is read by a native voice.
  const native = nativeVoiceFor(textLang, requested);
  const lang = native?.languageCode || languageCode || voiceLanguage(requested);
  const edgeVoice = edgeTts.isEdgeVoice(requested) ? requested : null;
  const attempts = [];
  if (native) {
    if (native.edgeVoice) attempts.push(["edge-neural", () => edgeTts.synthesize(text, { voice: native.edgeVoice, rate })]);
    attempts.push(["google-free", () => freeTts.synthesize(text, { languageCode: lang })]);
  } else if (requested.startsWith("google-")) {
    attempts.push(["google-free", () => freeTts.synthesize(text, { languageCode: lang })]);
    attempts.push(["edge-neural", () => edgeTts.synthesize(text, { voice: lang.startsWith("en-GB") ? "en-GB-SoniaNeural" : "en-US-AvaMultilingualNeural", rate })]);
  } else {
    for (const name of edgeVoice ? edgeTts.voiceFallbacks(edgeVoice) : []) {
      attempts.push([`edge-neural:${name}`, () => edgeTts.synthesize(text, { voice: name, rate })]);
    }
    attempts.push(["google-free", () => freeTts.synthesize(text, { languageCode: lang })]);
  }
  if (config.googleTtsApiKey) attempts.push(["google-cloud", () => googleCloud(text, lang)]);
  if (config.chatgptApiKey && !native) { // English-only voices: no use for other languages
    attempts.push(["rapidapi", async () => ({ ...(await require("./medicalService").synthesizeSpeech(text, edgeVoice || "en-US-JennyNeural")), provider: "rapidapi" })]);
  }

  let lastError = null;
  for (const [name, run] of attempts) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      logger.warn("tts.provider.failed", { provider: name, error: err?.message });
    }
  }
  throw lastError || new Error("No text-to-speech provider is available.");
}

module.exports = { synthesizeSpeech, voiceLanguage };
