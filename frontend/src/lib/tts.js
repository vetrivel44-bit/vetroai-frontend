// Speak text with VetroAI's free Google voice (/api/tts on the backend), and
// fall back to the browser's built-in voice if the backend can't be reached.
// Used by news "Listen" and Computer narration; chat voice mode has its own
// mic-aware loop in App.jsx that calls the same endpoint.
import { resolveApiBase } from "./apiBase.js";

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const API = resolveApiBase(import.meta.env?.VITE_API_BASE_URL, import.meta.env?.PROD, PROD_API);

let current = null;

export function stopSpeaking() {
  const playing = current;
  current = null;
  if (playing?.audio) { try { playing.audio.pause(); } catch { /* already stopped */ } }
  if (playing?.url) URL.revokeObjectURL(playing.url);
  try { window.speechSynthesis?.cancel(); } catch { /* no speech engine */ }
}

/**
 * Speak `text`. Resolves once playback has started (or failed); `onEnd` runs
 * when it finishes, errors, or is replaced by another call.
 */
export async function speakText(text, { voice, rate, onEnd } = {}) {
  stopSpeaking();
  const handle = {};
  current = handle;
  const finish = () => { if (current === handle) current = null; onEnd?.(); };
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  if (!clean) { finish(); return; }

  try {
    const res = await fetch(`${API}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voice }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    const blob = await res.blob();
    if (current !== handle) return; // replaced while loading
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    if (rate) audio.playbackRate = rate;
    handle.audio = audio;
    handle.url = url;
    audio.onended = () => { URL.revokeObjectURL(url); finish(); };
    audio.onerror = audio.onended;
    await audio.play();
  } catch {
    if (current !== handle) return;
    if (typeof window === "undefined" || !window.speechSynthesis) { finish(); return; }
    const utterance = new SpeechSynthesisUtterance(clean);
    if (rate) utterance.rate = rate;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }
}
