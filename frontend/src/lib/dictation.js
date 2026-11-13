// The composer's microphone ("Dictate"): speak, and the words land in the
// message box to check before sending, the way Claude's and ChatGPT's apps do
// it.
//
// It used to lean on the browser's own speech recognition, which Firefox
// doesn't have, the desktop app can't use (it needs Google's speech service,
// which only ships inside Chrome), and which failed silently in most other
// cases, so tapping the mic often did nothing. Now the app records the audio
// itself and the server types it out (POST /api/transcribe, Groq Whisper).
// The browser's recognition is kept only as the fallback for when recording
// isn't possible or the server has no speech-to-text.
//
// Any language: Whisper works out which one it hears. The app tells the
// server which languages this person uses (dictationHints) so that on a short
// clip it doesn't settle on a close neighbour, such as Hindi written in Urdu
// script or Tamil heard as Malayalam (backend dictationService.js).

// A voice message long enough for anyone; the recording is sent at this
// point rather than growing without end.
export const DICTATION_MAX_MS = 10 * 60 * 1000;
// Shorter than this is a tap, not speech.
export const DICTATION_MIN_MS = 450;

// The formats Whisper reads, in the order browsers do them best: Chrome,
// Edge and Firefox record webm/opus, Safari mp4/aac.
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];

/** The recording type to ask MediaRecorder for; "" lets it choose. */
export function pickRecordingType(Recorder = globalThis.MediaRecorder) {
  if (typeof Recorder?.isTypeSupported !== "function") return "";
  return RECORDING_TYPES.find((type) => { try { return Recorder.isTypeSupported(type); } catch { return false; } }) || "";
}

/** Can this browser record the microphone itself? */
export function canRecord(nav = globalThis.navigator, Recorder = globalThis.MediaRecorder) {
  return typeof nav?.mediaDevices?.getUserMedia === "function" && typeof Recorder === "function";
}

/** The browser's own speech recognition, or null. */
export function browserRecognition(win = globalThis.window) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

const EXTENSION = { webm: "webm", mp4: "mp4", ogg: "ogg", aac: "m4a", mpeg: "mp3", wav: "wav" };
/** A file name whose extension matches the recording, which is how Whisper tells the format. */
export function recordingFileName(type) {
  const sub = String(type || "").split(";")[0].split("/")[1] || "webm";
  return `voice.${EXTENSION[sub] || "webm"}`;
}

/** What to tell someone whose microphone didn't start (a getUserMedia error). */
export function micErrorMessage(err, { desktop = false } = {}) {
  const name = String(err?.name || "");
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError", "not-allowed", "service-not-allowed"].includes(name)) {
    return desktop
      ? "VetroAI isn't allowed to use the microphone. Turn it on in your computer's privacy settings, then try again."
      : "Microphone access is blocked. Allow it for this site (the icon at the left of the address bar), then try again.";
  }
  if (["NotFoundError", "DevicesNotFoundError", "OverconstrainedError", "audio-capture"].includes(name)) {
    return "No microphone was found. Connect one and try again.";
  }
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) {
    return "The microphone is in use by another app. Close it there and try again.";
  }
  if (name === "network") return "Speech recognition needs an internet connection. Check it and try again.";
  return "Couldn't start the microphone. Try again.";
}

export class DictationError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Is the server's speech-to-text there? true / false, or null when the
 * server couldn't be asked (then try it anyway).
 */
export async function serverDictationAvailable(apiBase, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  try {
    const res = await fetchImpl(`${apiBase}/transcribe`, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    const available = body?.data?.available ?? body?.available;
    return typeof available === "boolean" ? available : null;
  } catch {
    return null;
  }
}

/**
 * Sends a recording to the server; resolves to { text, language }: what was
 * said ("" for nothing) and the language it was said in (an ISO code).
 */
export async function transcribeRecording(apiBase, blob, { fetchImpl = globalThis.fetch, language, hints = [], timeoutMs = 90000, signal } = {}) {
  const form = new FormData();
  form.append("audio", blob, recordingFileName(blob?.type));
  if (language) form.append("language", language);
  if (hints.length) form.append("hints", hints.join(","));
  const timeout = AbortSignal.timeout(timeoutMs);
  // AbortSignal.any is recent (Safari 17.4); without it, cancelling wins.
  const both = signal ? (typeof AbortSignal.any === "function" ? AbortSignal.any([timeout, signal]) : signal) : timeout;
  let res;
  try {
    res = await fetchImpl(`${apiBase}/transcribe`, { method: "POST", body: form, signal: both });
  } catch (err) {
    if (signal?.aborted) throw new DictationError("cancelled", "Cancelled.");
    if (err?.name === "TimeoutError") throw new DictationError("timeout", "Typing out your recording took too long. Try a shorter one.");
    throw new DictationError("network", "Couldn't reach VetroAI to type out your recording. Check your connection and try again.");
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON: a proxy or gateway page */ }
  if (!res.ok) {
    const code = body?.data?.code || (res.status === 429 ? "ASR_BUSY" : "ASR_FAILED");
    const fallback = res.status === 429 ? "Voice typing is busy right now. Try again in a moment." : "Couldn't type out that recording. Try again.";
    throw new DictationError(code, body?.message || fallback, res.status);
  }
  const data = body?.data ?? body ?? {};
  return { text: String(data.text ?? "").trim(), language: typeof data.language === "string" ? data.language : null };
}

const LANGUAGE_CODE = /^[a-z]{2,3}$/;
const baseLanguage = (tag) => String(tag || "").trim().toLowerCase().split(/[-_]/)[0];

/**
 * The languages this person uses, most likely first, for the server: what
 * they dictated in lately, what their recent messages are written in, then
 * their browser's languages. Up to four ISO codes.
 */
export function dictationHints({ remembered = [], written = null, browser = [] } = {}) {
  const out = [];
  for (const tag of [...remembered, written, ...browser]) {
    const code = baseLanguage(tag);
    if (LANGUAGE_CODE.test(code) && !out.includes(code)) out.push(code);
  }
  return out.slice(0, 4);
}

const REMEMBERED_KEY = "vetro_dictation_langs";

/** The languages the last dictations came back in, newest first. */
export function rememberedLanguages(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage?.getItem(REMEMBERED_KEY) || "[]");
    return Array.isArray(list) ? list.filter((code) => LANGUAGE_CODE.test(code)).slice(0, 3) : [];
  } catch {
    return [];
  }
}

/** Puts `language` first in the remembered list. */
export function rememberLanguage(language, storage = globalThis.localStorage) {
  const code = baseLanguage(language);
  if (!LANGUAGE_CODE.test(code)) return;
  try {
    const next = [code, ...rememberedLanguages(storage).filter((c) => c !== code)].slice(0, 3);
    storage?.setItem(REMEMBERED_KEY, JSON.stringify(next));
  } catch { /* private mode or storage full: hints just come from elsewhere */ }
}

// Chinese, Japanese and Thai are written without spaces between words.
const NO_SPACES = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\u0e00-\u0e7f\u3000-\u303f\uff00-\uffef]/u;

/** The message box after dictating: what was there, a space, what was said. */
export function appendDictated(current, spoken) {
  const words = String(spoken || "").trim();
  const before = String(current || "");
  if (!words) return before;
  if (!before.trim()) return words;
  const kept = before.replace(/\s+$/, "");
  if (/\n$/.test(before)) return `${kept}\n${words}`;
  const joiner = NO_SPACES.test(kept.slice(-1)) && NO_SPACES.test(words[0]) ? "" : " ";
  return `${kept}${joiner}${words}`;
}

/** 0:07, 1:32 */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
