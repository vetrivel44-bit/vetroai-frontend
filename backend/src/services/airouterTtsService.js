"use strict";

// Voice Mode's speech: Voxtral Mini TTS (default) or tts-1, via AI Router.
//
// The reply text goes to POST {AIROUTER_BASE_URL}/audio/speech and the audio
// streams back chunk by chunk, so the browser plays on the first bytes.
//
// Voxtral has ONE natural voice (no voice parameter accepted), ignores speed,
// and can't produce AAC (opus/mp3/flac/wav only). When Voxtral is selected the
// service omits voice and speed; the frontend applies playback speed in-browser
// instead (signalled by the X-TTS-Honors-Rate: false header).

const { Readable } = require("stream");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const { startTimeout } = require("../utils/withTimeout");

// tts-1's voices (Voxtral has only one and rejects any voice parameter).
const VOICES = ["nova", "shimmer", "alloy", "echo", "fable", "onyx"];
const FORMATS = { aac: "audio/aac", mp3: "audio/mpeg", opus: "audio/ogg", wav: "audio/wav", flac: "audio/flac" };
const FORMAT = () => (FORMATS[String(config.airouterTtsFormat || "").toLowerCase()] ? String(config.airouterTtsFormat).toLowerCase() : "opus");
const DEFAULT_VOICE = "nova";
const isVoxtral = (m) => /voxtral/i.test(m);
// tts-1 reads up to 4096 characters a request. Voice Mode speaks in clips far
// shorter than that; this only guards a direct call.
const MAX_CHARS = 4096;
// How long AI Router gets to answer with headers. Only the wait for the reply
// to start is timed: aborting a streamed body would cut the audio off.
const START_TIMEOUT_MS = () => config.airouterTtsStartTimeoutMs || 45000;

// The voices people already have saved in their browser (Edge's neural voices,
// Google's free voice, Sarvam's Premium ones) map to the closest tts-1 voice,
// so an old pick still speaks instead of falling silent.
const LEGACY = [
  [/^(?:en-US-Ava|google-|sarvam-(?:aparna|sanchita|ishita|priya))/i, "nova"],
  [/^(?:en-US-(?:Jenny|Aria|Emma|Michelle)|en-GB-(?:Sonia|Libby)|en-IN-Neerja|en-AU-Natasha)/i, "shimmer"],
  [/^(?:en-US-(?:Guy|Andrew|Brian|Steffan)|en-GB-(?:Ryan|Thomas)|en-IN-Prabhat|en-AU-William|sarvam-(?:dev|shubh|ratan))/i, "onyx"],
];

/** The tts-1 voice to speak with, for a new id or one saved by an older build. */
function voiceFor(id) {
  const wanted = String(id || "").trim();
  if (VOICES.includes(wanted)) return wanted;
  for (const [pattern, voice] of LEGACY) if (pattern.test(wanted)) return voice;
  return DEFAULT_VOICE;
}

/** "a person speaks a little faster" as tts-1's speed: "+6%" → 1.06, within 0.25–4. */
function speedFor(rate, speed) {
  const match = /^([+-]\d{1,3})%$/.exec(String(rate || ""));
  const asked = Number(speed) > 0 ? Number(speed) : 1;
  const factor = (1 + (match ? Number(match[1]) / 100 : 0)) * asked;
  if (!Number.isFinite(factor) || Math.abs(factor - 1) < 0.01) return 1;
  return Math.min(4, Math.max(0.25, Math.round(factor * 100) / 100));
}

const available = () => Boolean(String(config.airouterApiKey || "").trim());

function apiKey() {
  return String(config.airouterApiKey || "").trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

function endpoint() {
  const base = String(config.airouterBaseUrl || "https://api.airouter.in/v1").replace(/\/+$/, "");
  return `${base}/audio/speech`;
}

class SpeechError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SpeechError";
    this.status = status;
  }
}

/**
 * Ask AI Router for the audio and resolve with the upstream response still
 * unread, so the caller can stream it. Rejects with a SpeechError.
 */
async function requestSpeech({ text, voice, rate, speed }) {
  const input = String(text ?? "");
  if (!input.trim()) throw new SpeechError(400, "Nothing to speak.");
  if (!available()) throw new SpeechError(503, "Voice playback isn't set up on this server (AIROUTER_API_KEY).");

  const model = config.airouterTtsModel || "mistral/voxtral-mini-tts-3";
  const voxtral = isVoxtral(model);
  // Voxtral can't do AAC; fall back to opus when the config says aac.
  const fmt = voxtral && FORMAT() === "aac" ? "opus" : FORMAT();
  const body = {
    model,
    input: input.slice(0, MAX_CHARS),
    response_format: fmt,
  };
  // Voxtral rejects voice and speed parameters.
  if (!voxtral) {
    body.voice = voiceFor(voice);
    const pace = speedFor(rate, speed);
    if (pace !== 1) body.speed = pace;
  }

  const wait = startTimeout(START_TIMEOUT_MS());
  let res;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify(body),
      signal: wait.signal,
    });
  } catch (err) {
    logger.warn("tts.airouter.failed", { error: err?.message });
    throw new SpeechError(502, `AI Router's voice couldn't be reached: ${err?.message || "network error"}`);
  } finally {
    // Headers (or failure) arrived: the body may now take as long as it needs.
    wait.started();
  }

  if (!res.ok) {
    const detail = typeof res.text === "function" ? (await res.text().catch(() => "")).slice(0, 200) : "";
    logger.warn("tts.airouter.status", { status: res.status, detail });
    if (res.status === 429) throw new SpeechError(429, "Voice is busy right now. Try again in a moment.");
    throw new SpeechError(502, `AI Router's voice returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const usedVoice = voxtral ? "voxtral" : body.voice;
  const honorsRate = !voxtral;
  return { res, model: body.model, voice: usedVoice, honorsRate };
}

/** The whole clip as a Buffer (a direct call, or a player that can't stream). */
async function synthesize({ text, voice, rate, speed }) {
  const { res, model, voice: used, honorsRate } = await requestSpeech({ text, voice, rate, speed });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 200) throw new SpeechError(502, "AI Router's voice returned no audio.");
  const fmt = isVoxtral(model) && FORMAT() === "aac" ? "opus" : FORMAT();
  return { buffer, contentType: FORMATS[fmt], provider: "airouter", model, voice: `${model}/${used}`, honorsRate };
}

/**
 * Write the audio to an Express response as it arrives: no temp file, no
 * buffering of the whole clip, so playback starts on the first chunk.
 */
async function streamSpeech({ text, voice, rate, speed }, res) {
  const { res: upstream, model, voice: used, honorsRate } = await requestSpeech({ text, voice, rate, speed });
  const fmt = isVoxtral(model) && FORMAT() === "aac" ? "opus" : FORMAT();
  const contentType = String(upstream.headers?.get?.("content-type") || "").startsWith("audio/")
    ? upstream.headers.get("content-type")
    : FORMATS[fmt];

  res.status(200);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-TTS-Provider", "airouter");
  res.setHeader("X-TTS-Model", model);
  res.setHeader("X-TTS-Voice", String(`${model}/${used}`).slice(0, 80));
  res.setHeader("X-TTS-Honors-Rate", honorsRate ? "true" : "false");
  res.flushHeaders?.();

  if (!upstream.body) {
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length) throw new SpeechError(502, "AI Router's voice returned no audio.");
    res.end(buffer);
    return;
  }
  // Node's web streams read from AI Router's body straight through to the socket.
  const audio = Readable.fromWeb(upstream.body);
  audio.on("error", (err) => {
    logger.warn("tts.airouter.streamError", { error: err?.message });
    try { res.end(); } catch { /* the client went away */ }
  });
  audio.pipe(res);
}

module.exports = {
  synthesize,
  streamSpeech,
  voiceFor,
  speedFor,
  available,
  SpeechError,
  VOICES,
  DEFAULT_VOICE,
  MAX_CHARS,
};
