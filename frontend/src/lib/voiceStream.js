// Speak a reply while it is still streaming, sentence by sentence.
//
// Voice mode used to wait for the whole reply (and any extra lookups), then
// turn up to 800 characters into speech in one request, so the first word was
// heard many seconds after the answer started. Here each finished sentence is
// sent to /api/tts as soon as it has streamed in, the next sentences are
// fetched while the current one plays, and playback stays in order: speech
// starts about a second after the model starts answering.
import { pickBrowserVoice, describeTtsVoice } from "../utils/browserVoice.js";

const MAX_SPOKEN_CHARS = 1500; // a spoken reply should not read out an essay
const MAX_PARALLEL_FETCHES = 3;
const MIN_CHUNK = 24; // very short sentences ride along with the next one

/** Text that can be read aloud: no code, markdown, links or math. */
export function speakableText(raw) {
  // Even parts are outside code fences; an unclosed fence drops its tail.
  const text = String(raw || "").split("```").filter((_, i) => i % 2 === 0).join(" ");
  return text
    .replace(/`[^`]*`/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, " equation ")
    .replace(/\$[^$\n]+\$/g, " math ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*#_~>|]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+([.!?,])/g, "$1")
    .replace(/([.!?])(?:\s*\.)+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function leavesNothingOpen(prefix) {
  const count = (re) => (prefix.match(re) || []).length;
  const lastLink = prefix.lastIndexOf("](");
  return count(/`/g) % 2 === 0
    && count(/\$/g) % 2 === 0
    && count(/\[/g) === count(/\]/g)
    && (lastLink === -1 || prefix.indexOf(")", lastLink) !== -1);
}

/**
 * Length of the longest prefix of a streaming reply that ends a sentence and
 * leaves no code, math or link half-written, i.e. the part safe to speak now.
 */
export function stableCut(raw) {
  const text = String(raw || "");
  const cuts = [];
  const re = /[.!?](?=\s)|\n/g;
  let match;
  while ((match = re.exec(text))) cuts.push(match[0] === "\n" ? match.index : match.index + 1);
  for (let i = cuts.length - 1; i >= 0; i--) {
    if (leavesNothingOpen(text.slice(0, cuts[i]))) return cuts[i];
  }
  return 0;
}

/** Sentence-sized chunks, with very short sentences merged into the next. */
export function splitSentences(text) {
  const pieces = String(text || "").match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
  const chunks = [];
  let buffer = "";
  for (const piece of pieces) {
    buffer += piece;
    if (buffer.trim().length >= MIN_CHUNK) { chunks.push(buffer.trim()); buffer = ""; }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

let active = null;

/** Stop whatever reply is being spoken (tap-to-interrupt, closing voice mode). */
export function stopActiveSpeaker() {
  active?.stop();
}

/**
 * @param {{ apiBase: string, voice?: string, onStart?: () => void,
 *           onDone?: () => void, onStop?: () => void }} options
 *   onStart: the first audio is about to play. onDone: everything was spoken.
 *   onStop: speech was cut short (error, abort, interrupt).
 */
export function createStreamingSpeaker({ apiBase, voice, onStart, onDone, onStop }) {
  active?.stop();
  let abort = new AbortController();
  let queue = [];
  let spokenLength = 0;
  let queuedChars = 0;
  let playing = false;
  let started = false;
  let finished = false;
  let stopped = false;
  let done = false;
  let inFlight = 0;
  const waiting = [];
  // Keeps the mic shut between sentences (see isTTSActive in App.jsx).
  window.isTTSLoading = true;

  const limited = (task) => new Promise((resolve) => {
    const run = () => {
      inFlight++;
      task().then(resolve, () => resolve(null)).finally(() => { inFlight--; waiting.shift()?.(); });
    };
    if (inFlight < MAX_PARALLEL_FETCHES) run(); else waiting.push(run);
  });

  const fetchAudio = (text) => limited(async () => {
    const res = await fetch(`${apiBase}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    const blob = await res.blob();
    if (!blob.size) throw new Error("empty audio");
    return blob;
  });

  const playBlob = (blob) => new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    window.currentAudio = audio;
    const end = () => {
      URL.revokeObjectURL(url);
      if (window.currentAudio === audio) window.currentAudio = null;
      resolve();
    };
    audio.onended = end;
    audio.onerror = end;
    audio.play().catch(end);
  });

  // The backend voice could not be reached for this sentence: say it with the
  // browser's own voice, picked to match the chosen one.
  const playBrowser = (text) => new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    try {
      const match = pickBrowserVoice(synth.getVoices(), voice);
      if (match) utterance.voice = match;
      utterance.lang = match?.lang || describeTtsVoice(voice).lang;
    } catch { /* default voice */ }
    utterance.onend = resolve;
    utterance.onerror = resolve;
    synth.speak(utterance);
  });

  const complete = () => {
    if (done || stopped) return;
    done = true;
    window.isTTSLoading = false;
    if (active === speaker) active = null;
    onDone?.();
  };

  const pump = async () => {
    if (playing || stopped) return;
    const item = queue.shift();
    if (!item) { if (finished) complete(); return; }
    playing = true;
    try {
      const blob = await item.audio;
      if (stopped) return;
      if (!started) { started = true; onStart?.(); }
      if (blob) await playBlob(blob); else await playBrowser(item.text);
    } finally {
      playing = false;
      if (!stopped) pump();
    }
  };

  const enqueue = (text) => {
    if (!text || queuedChars >= MAX_SPOKEN_CHARS) return;
    const clipped = text.slice(0, MAX_SPOKEN_CHARS - queuedChars);
    queuedChars += clipped.length;
    queue.push({ text: clipped, audio: fetchAudio(clipped) });
    pump();
  };

  const takeNew = (raw, everything) => {
    const full = String(raw || "");
    const cut = everything ? full.length : stableCut(full);
    if (!cut) return;
    const spoken = speakableText(full.slice(0, cut));
    if (spoken.length <= spokenLength) return;
    const fresh = spoken.slice(spokenLength);
    spokenLength = spoken.length;
    for (const sentence of splitSentences(fresh)) enqueue(sentence);
  };

  const silence = () => {
    abort.abort();
    queue = [];
    const audio = window.currentAudio;
    if (audio) { try { audio.pause(); } catch { /* already stopped */ } window.currentAudio = null; }
    try { window.speechSynthesis?.cancel(); } catch { /* no speech engine */ }
  };

  const speaker = {
    /** The reply so far (the full accumulated text, not a delta). */
    push(raw) { if (!stopped && !finished) takeNew(raw, false); },
    /** The reply is complete: speak whatever is left, then call onDone. */
    finish(raw) {
      if (stopped || finished) return;
      takeNew(raw, true);
      finished = true;
      if (!playing && !queue.length) complete();
    },
    /** The request is being retried from scratch. */
    restart() {
      if (stopped) return;
      silence();
      abort = new AbortController();
      spokenLength = 0;
      queuedChars = 0;
      started = false;
      window.isTTSLoading = true;
    },
    stop() {
      if (stopped || done) return;
      stopped = true;
      silence();
      window.isTTSLoading = false;
      if (active === speaker) active = null;
      onStop?.();
    },
    get finished() { return finished || stopped; },
  };
  active = speaker;
  return speaker;
}
