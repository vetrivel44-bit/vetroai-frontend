// The composer's microphone ("Dictate"): speak, and the words land in the
// message box to check before sending.
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
// server which languages this person uses (dictationHints), the one they type
// in first, so that on a short clip it doesn't settle on a close neighbour,
// such as Hindi written in Urdu script or Tamil heard as Malayalam, or write
// English said with an Indian accent in Tamil or Hindi script (backend
// dictationService.js). The language can also be picked by hand
// (SPEECH_LANGUAGES), and then it's never guessed.

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
    // A server that predates /api/transcribe (the website can go live a few
    // minutes before the backend does): no speech-to-text there.
    if (res.status === 404) return false;
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
    const code = body?.data?.code || (res.status === 429 ? "ASR_BUSY" : res.status === 404 ? "ASR_NOT_CONFIGURED" : "ASR_FAILED");
    const fallback = res.status === 429 ? "Voice typing is busy right now. Try again in a moment." : "Couldn't type out that recording. Try again.";
    // 404: the route itself is missing (an older backend), and its "Route
    // not found" means nothing to the person.
    const message = res.status === 404 ? "Voice typing isn't available on the server yet." : body?.message || fallback;
    throw new DictationError(code, message, res.status);
  }
  const data = body?.data ?? body ?? {};
  return { text: String(data.text ?? "").trim(), language: typeof data.language === "string" ? data.language : null };
}

const LANGUAGE_CODE = /^[a-z]{2,3}$/;
const baseLanguage = (tag) => String(tag || "").trim().toLowerCase().split(/[-_]/)[0];

/**
 * The languages this person uses, most likely first, for the server: the one
 * their recent messages are written in, what they dictated in lately, then
 * their browser's languages. Up to four ISO codes.
 *
 * What they type comes first because it's how they want their words written:
 * someone who types in English and says something in English with a Tamil
 * accent wants English back, not Tamil script. (Remembered languages used to
 * come first, so one such mistake was remembered and repeated.)
 */
export function dictationHints({ remembered = [], written = null, browser = [] } = {}) {
  const out = [];
  for (const tag of [written, ...remembered, ...browser]) {
    const code = baseLanguage(tag);
    if (LANGUAGE_CODE.test(code) && !out.includes(code)) out.push(code);
  }
  return out.slice(0, 4);
}

// v2: the list kept before could hold a language Whisper got wrong (English
// heard as Tamil), which then steered every later recording; start afresh.
const REMEMBERED_KEY = "vetro_dictation_langs_v2";

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

// ── The language the person speaks ──────────────────────────────────────────
// "Auto" lets the server work it out; picking one means it's never guessed
// (the fix when Auto gets it wrong). Kept per device.

export const SPEECH_LANGUAGES = [
  { code: "", label: "Auto-detect", short: "Auto" },
  { code: "en", label: "English", short: "EN" },
  { code: "ta", label: "தமிழ் · Tamil", short: "TA" },
  { code: "hi", label: "हिन्दी · Hindi", short: "HI" },
  { code: "te", label: "తెలుగు · Telugu", short: "TE" },
  { code: "kn", label: "ಕನ್ನಡ · Kannada", short: "KN" },
  { code: "ml", label: "മലയാളം · Malayalam", short: "ML" },
  { code: "bn", label: "বাংলা · Bengali", short: "BN" },
  { code: "mr", label: "मराठी · Marathi", short: "MR" },
  { code: "gu", label: "ગુજરાતી · Gujarati", short: "GU" },
  { code: "pa", label: "ਪੰਜਾਬੀ · Punjabi", short: "PA" },
  { code: "ur", label: "اردو · Urdu", short: "UR" },
  { code: "es", label: "Español · Spanish", short: "ES" },
  { code: "fr", label: "Français · French", short: "FR" },
  { code: "de", label: "Deutsch · German", short: "DE" },
  { code: "pt", label: "Português · Portuguese", short: "PT" },
  { code: "it", label: "Italiano · Italian", short: "IT" },
  { code: "ar", label: "العربية · Arabic", short: "AR" },
  { code: "ru", label: "Русский · Russian", short: "RU" },
  { code: "zh", label: "中文 · Chinese", short: "ZH" },
  { code: "ja", label: "日本語 · Japanese", short: "JA" },
  { code: "ko", label: "한국어 · Korean", short: "KO" },
  { code: "id", label: "Bahasa Indonesia", short: "ID" },
];
const SPEECH_LANGUAGE_KEY = "vetro_speech_lang";
const PICKABLE = new Set(SPEECH_LANGUAGES.map((l) => l.code));

/** The language picked for the microphone, or "" for Auto. */
export function savedSpeechLanguage(storage = globalThis.localStorage) {
  try {
    const code = storage?.getItem(SPEECH_LANGUAGE_KEY) || "";
    return PICKABLE.has(code) ? code : "";
  } catch {
    return "";
  }
}

export function saveSpeechLanguage(code, storage = globalThis.localStorage) {
  const value = PICKABLE.has(code) ? code : "";
  try {
    if (value) storage?.setItem(SPEECH_LANGUAGE_KEY, value);
    else storage?.removeItem(SPEECH_LANGUAGE_KEY);
  } catch { /* private mode: it lasts until the page is closed */ }
  return value;
}

// The browser's own recognizer needs a full locale, and the region matters:
// its en-IN model knows Indian accents and names far better than en-US.
const DEFAULT_REGION = {
  en: "US", ta: "IN", hi: "IN", te: "IN", kn: "IN", ml: "IN", bn: "IN", mr: "IN", gu: "IN", pa: "IN", ur: "IN",
  es: "ES", fr: "FR", de: "DE", pt: "BR", it: "IT", ar: "SA", ru: "RU", zh: "CN", ja: "JP", ko: "KR", id: "ID",
};
const INDIA_TIME = /^Asia\/(?:Kolkata|Calcutta)$/;
const localTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };

/**
 * The locale for the browser's speech recognizer: "en" → "en-IN" in India,
 * the person's own variant if their browser lists one ("en-GB"), otherwise
 * the language's main one ("ta-IN", "es-ES").
 */
export function recognitionLocale(language, { languages = globalThis.navigator?.languages || [], timeZone = localTimeZone() } = {}) {
  const base = baseLanguage(language) || "en";
  if (base === "en" && INDIA_TIME.test(timeZone)) return "en-IN";
  const own = Array.from(languages || []).find((tag) => baseLanguage(tag) === base && /^[a-z]{2,3}[-_][A-Za-z]{2}$/.test(String(tag)));
  if (own) return String(own).replace("_", "-");
  return DEFAULT_REGION[base] ? `${base}-${DEFAULT_REGION[base]}` : base;
}

/**
 * What the browser's recognizer has heard so far: { final, interim }.
 * Chrome on Android, in continuous mode, hands back each final result with
 * everything before it repeated ("hello", "hello how are you"), so joining
 * them typed every phrase two or three times. A result that repeats the one
 * before replaces it.
 */
export function joinRecognitionResults(results) {
  const finals = [];
  let interim = "";
  const same = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().startsWith(b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  for (const result of Array.from(results || [])) {
    const text = String(result?.[0]?.transcript || "").trim();
    if (!text) continue;
    if (!result.isFinal) { interim = interim ? `${interim} ${text}` : text; continue; }
    const last = finals[finals.length - 1];
    if (last && same(text, last)) finals[finals.length - 1] = text;
    else if (!(last && same(last, text))) finals.push(text);
  }
  const final = finals.join(" ");
  // Android's interim result repeats the finals before it, too.
  if (final && interim && same(interim, final)) interim = interim.split(/\s+/).slice(final.split(/\s+/).length).join(" ");
  return { final, interim };
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
