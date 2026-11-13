// Speak a reply while it is still streaming, a few sentences at a time.
//
// Voice mode used to wait for the whole reply (and any extra lookups), then
// turn up to 800 characters into speech in one request, so the first word was
// heard many seconds after the answer started. Here the first sentence is
// sent to /api/tts as soon as it has streamed in, the next ones are fetched
// while it plays, and playback stays in order: speech starts about a second
// after the model starts answering.
//
// Read aloud uses the same speaker on a finished reply. It used to speak one
// sentence per clip, which sounded robotic and dragged:
//   • every clip carries its own silence at the start and the end, and a new
//     audio element has to start for each one, so each full stop became a
//     long wait;
//   • a sentence voiced on its own starts flat every time, with none of the
//     tone carried over from the sentence before;
//   • a long reply asked for dozens of clips at once, ran into the server's
//     rate limit, and those sentences were read by the browser's robotic
//     voice instead.
// Now, after the opening sentence, each clip holds a few sentences (the voice
// reads them with natural flow and its own pauses), only a few clips are
// fetched ahead of the one playing, a clip that fails is asked for again
// before giving up on it, and clips are played back to back with their
// silence trimmed and a short, natural pause between them.
import { pickBrowserVoice, describeTtsVoice } from "../utils/browserVoice.js";
import { detectSpeechLanguage } from "./speechLanguage.js";

const MAX_SPOKEN_CHARS = 1500; // a spoken reply should not read out an essay
// Clips fetched ahead of the one playing. Enough that the next one is always
// ready; few enough that a long Read aloud doesn't ask for dozens at once.
const MAX_AHEAD = 3;
// Times a clip is asked for again after the server was busy or failed.
const MAX_RETRIES = 2;
const MIN_CHUNK = 24; // very short sentences ride along with the next one
// The first words are sent as soon as a clause this long is complete, rather
// than waiting for the end of a long first sentence.
const FIRST_CLAUSE = 48;
// Characters per clip after the opening sentence: voice mode's replies are
// short and stream in, Read aloud's are long and already there. The clip after
// the opening one is kept shorter so it's ready before the opening one ends.
export const VOICE_CHUNK_CHARS = 180;
export const READ_ALOUD_CHUNK_CHARS = 420;
const SECOND_CHUNK_CHARS = 220;

// Emoji and the invisible characters that build them (skin tones, joiners,
// variation selectors, keycaps, flags). A speech engine reads "😂" out as
// "face with tears of joy".
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|‍|︎|️|⃣)+/gu;

/** Text that can be read aloud: no code, markdown, links, math, emoji or citations. */
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
    // Source numbers from web answers: "[1]", "[2, 3]", "【4】".
    .replace(/\s*(?:\[\d+(?:\s*[,–-]\s*\d+)*\]|【\d+】)/g, "")
    .replace(EMOJI, " ")
    // Emoticons typed as text.
    .replace(/(?:^|\s)(?:[:;=8][-^']?[)(DPpOo3/\\|*]|<3|\^_\^|xD)(?=\s|$|[.,!?])/g, " ")
    // A table's |---|---| row and a horizontal rule aren't read at all...
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "")
    // ...and a table row is read as its cells: "Chennai, 38°C".
    .replace(/^[ \t]*\|(.*?)\|?[ \t]*$/gm, (_, cells) => cells.split("|").map((c) => c.trim()).filter(Boolean).join(", "))
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/[*#_~>|]/g, "")
    .replace(/[ \t]*(?:→|⟶|➜|➡|->)[ \t]*/g, " to ")
    .replace(/\be\.g\.(?=[\s,])/gi, "for example")
    .replace(/\bi\.e\.(?=[\s,])/gi, "that is")
    // A line that ends without punctuation (a heading, a list item, a table
    // row) gets a full stop, so it's said as a phrase of its own instead of
    // running straight into the next line.
    .replace(/([^\s.!?:;,])[ \t]*(?=\n)/g, "$1.")
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
 * For the opening words only: the end of the first clause (at a comma, colon,
 * semicolon or dash) once there are FIRST_CLAUSE characters before it, so a
 * long first sentence starts being spoken before it is finished. 0 if none.
 */
export function firstClauseCut(raw) {
  const text = String(raw || "");
  const re = /[,;:—–](?=\s)| - /g;
  let match;
  while ((match = re.exec(text))) {
    const cut = match.index + match[0].trimEnd().length;
    if (cut >= FIRST_CLAUSE && leavesNothingOpen(text.slice(0, cut))) return cut;
  }
  return 0;
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

// A full stop that ends a short form rather than a sentence: "Dr. Rao",
// "Mr. Kumar", "No. 5", "etc. and", "U.S. visa". Breaking a clip there would
// put a pause in the middle of a sentence.
const SHORT_FORM = /(?:^|[\s(])(?:mr|mrs|ms|dr|prof|sr|jr|st|mt|vs|etc|no|nos|approx|fig|vol|inc|ltd|co|dept|govt|rs|[a-z]\.[a-z]|[a-z])\.$/i;

/**
 * The sentences of `text`, each with the space after it. A sentence ends at
 * . ! or ? followed by a space (so "3.5" and "VetroAI.com" stay whole), and
 * not after a short form like "Dr.".
 */
export function sentencesOf(text) {
  const source = String(text || "");
  const out = [];
  const re = /[.!?]+["'’”)\]]*(?=\s|$)/g;
  let start = 0;
  let match;
  while ((match = re.exec(source))) {
    const end = match.index + match[0].length;
    if (match[0] === "." && end < source.length && SHORT_FORM.test(source.slice(start, end))) continue;
    const after = end + (/^\s*/.exec(source.slice(end))?.[0].length || 0);
    out.push(source.slice(start, after));
    start = after;
    re.lastIndex = after;
  }
  if (start < source.length) out.push(source.slice(start));
  return out.filter((sentence) => sentence.trim());
}

/**
 * Clip-sized chunks of text.
 * - With no `target`: one sentence per chunk, very short ones merged into
 *   the next.
 * - With `target` (characters, or a function of the chunk's index): as many
 *   whole sentences as fit, so the voice reads them with its own flow.
 * `first`: these are the reply's opening words, so the first sentence goes
 * out on its own however short ("Oh nice!") and speech starts sooner.
 */
export function splitSentences(text, { first = false, target = 0 } = {}) {
  const chunks = [];
  let buffer = "";
  const limitFor = (index) => (typeof target === "function" ? target(index) : target) || 0;
  for (const sentence of sentencesOf(text)) {
    const opening = first && !chunks.length;
    const minimum = opening ? 2 : MIN_CHUNK;
    const limit = limitFor(chunks.length);
    // This sentence would overflow the chunk: close it first.
    if (limit && !opening && buffer.trim().length >= minimum && (buffer + sentence).trim().length > limit) {
      chunks.push(buffer.trim());
      buffer = "";
    }
    buffer += sentence;
    if ((!limit || opening) && buffer.trim().length >= minimum) { chunks.push(buffer.trim()); buffer = ""; }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

// ── Playback ────────────────────────────────────────────────────────────────
// Clips are played through the Web Audio API where it's safe to, which lets
// them be trimmed of silence and started exactly when wanted. iPhones and
// iPads keep the plain <audio> element: Web Audio there goes quiet whenever
// the ring/silent switch is on.

const isAppleMobile = () => {
  const nav = globalThis.navigator;
  const ua = String(nav?.userAgent || "");
  return /iP(?:hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1);
};

let sharedContext = null;
function audioContext() {
  if (sharedContext && sharedContext.state !== "closed") return sharedContext;
  const win = globalThis.window;
  const Context = win?.AudioContext || win?.webkitAudioContext;
  if (typeof Context !== "function" || isAppleMobile()) return null;
  try { sharedContext = new Context(); } catch { sharedContext = null; }
  return sharedContext;
}

/**
 * Call from a click (Read aloud, opening voice mode): browsers only let audio
 * start after the person has interacted with the page.
 */
export function unlockSpeechAudio() {
  const ctx = audioContext();
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
}

const running = async (ctx) => {
  if (ctx.state === "running") return true;
  try { await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 400))]); } catch { /* not allowed yet */ }
  return ctx.state === "running";
};

const decode = (ctx, data) => new Promise((resolve, reject) => {
  // Older Safari only has the callback form.
  const result = ctx.decodeAudioData(data, resolve, reject);
  if (result && typeof result.then === "function") result.then(resolve, reject);
});

/**
 * Where the speech in a clip starts and ends, in seconds: the silence speech
 * engines put before and after every clip is left out, keeping a breath of it
 * so no sound is clipped.
 */
export function speechBounds(samples, sampleRate, { threshold = 0.006, lead = 0.03, tail = 0.08 } = {}) {
  const length = samples?.length || 0;
  const duration = length / sampleRate;
  const step = Math.max(1, Math.round(sampleRate * 0.01));
  let first = -1;
  let last = -1;
  for (let i = 0; i < length; i += step) {
    const end = Math.min(length, i + step);
    let peak = 0;
    for (let j = i; j < end; j++) {
      const value = Math.abs(samples[j]);
      if (value > peak) peak = value;
    }
    if (peak > threshold) {
      if (first < 0) first = i;
      last = end;
    }
  }
  if (first < 0) return { start: 0, end: duration };
  return { start: Math.max(0, first / sampleRate - lead), end: Math.min(duration, last / sampleRate + tail) };
}

/**
 * The pause to leave after a clip, in seconds, from how its text ends: about
 * what a person leaves after a sentence, less after a clause. With the clip's
 * own silence trimmed, this is the whole gap.
 */
export function pauseAfter(text) {
  const end = String(text || "").trim();
  if (/[.!?]["'’”)\]]*$/.test(end)) return 0.26;
  if (/[,;:—–-]$/.test(end)) return 0.1;
  return 0.18;
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});


let active = null;
const DUCKED_VOLUME = 0.18;

/** Stop whatever reply is being spoken (tap-to-interrupt, closing voice mode). */
export function stopActiveSpeaker() {
  active?.stop();
}

/**
 * Turn the reply being spoken down while the person starts talking over it,
 * and back up if it turns out they didn't (a cough, the TV). Voice mode
 * decides once it has heard what they said.
 */
export function duckActiveSpeaker(down) {
  active?.duck(down);
}

// ── Read-aloud controls ─────────────────────────────────────────────────────
// Read aloud can be paused, moved a sentence back or forward, and sped up or
// slowed down. The speed is asked of the voice itself (Edge's rate, Bulbul's
// pace), so a faster voice keeps its pitch; only the clip already playing
// when the speed changes is sped up in the browser, and Google's free voice,
// which has no speed of its own.

/** The speeds the read-aloud bar offers. */
export const READ_SPEEDS = [0.8, 1, 1.25, 1.5];

const clampSpeed = (value) => {
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0 ? Math.min(2, Math.max(0.5, speed)) : 1;
};

/**
 * The speed to ask /api/tts for: the voice's own adjustment ("+6%", voice
 * mode's) times the listener's speed, as a percentage of two digits at most.
 * Undefined when that's the voice's own speed.
 */
export function combinedRate(rate, speed = 1) {
  const base = /^([+-]\d{1,3})%$/.exec(String(rate || ""));
  const factor = (1 + (base ? Number(base[1]) / 100 : 0)) * clampSpeed(speed);
  const percent = Math.max(-50, Math.min(99, Math.round((factor - 1) * 100)));
  if (!percent) return undefined;
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

// Voices that read at the speed they're given no speed of their own.
const IGNORES_RATE = /^(?:google|rapidapi)/;

/**
 * Which of a clip's sentences is being heard `fraction` of the way through
 * its speech, judged by their lengths (a voice reads at an even pace).
 */
export function sentenceAt(parts, fraction) {
  const lengths = parts.map((part) => String(part).length);
  const total = lengths.reduce((sum, n) => sum + n, 0) || 1;
  const at = Math.min(1, Math.max(0, Number(fraction) || 0)) * total;
  let reached = 0;
  for (let i = 0; i < lengths.length; i++) {
    reached += lengths[i];
    if (at < reached) return i;
  }
  return Math.max(0, lengths.length - 1);
}

/** How far into a clip's speech sentence `index` starts, 0–1, by length. */
export function fractionBefore(parts, index) {
  const lengths = parts.map((part) => String(part).length);
  const total = lengths.reduce((sum, n) => sum + n, 0) || 1;
  return lengths.slice(0, Math.max(0, index)).reduce((sum, n) => sum + n, 0) / total;
}

/**
 * Where to start a clip so it begins at a sentence, in seconds: that
 * sentence's share of the speech, moved to the quietest moment close by
 * (the breath before the sentence), so a skip doesn't start mid-word.
 */
export function seekPoint(samples, sampleRate, { start, end }, fraction) {
  if (!(fraction > 0)) return start;
  const estimate = start + (end - start) * fraction;
  const length = samples?.length || 0;
  const span = Math.max(1, Math.round(sampleRate * 0.03));
  const step = Math.max(1, Math.round(span / 3));
  const from = Math.max(0, Math.floor((estimate - 0.6) * sampleRate));
  const to = Math.min(length - span, Math.ceil((estimate + 0.4) * sampleRate));
  let best = estimate;
  let bestLevel = Infinity;
  for (let i = from; i <= to; i += step) {
    let sum = 0;
    for (let j = i; j < i + span; j++) sum += Math.abs(samples[j]);
    // Of two equally quiet moments, the one nearer the estimate.
    const level = sum / span + Math.abs(i / sampleRate - estimate) * 0.002;
    if (level < bestLevel) { bestLevel = level; best = i / sampleRate; }
  }
  return Math.max(start, Math.min(end - 0.05, best));
}

/**
 * @param {{ apiBase: string, voice?: string, onStart?: () => void,
 *           onDone?: () => void, onStop?: () => void,
 *           onSentence?: (index: number, text: string) => void }} options
 *   onStart: the first audio is about to play. onDone: everything was spoken.
 *   onStop: speech was cut short (error, abort, interrupt).
 *   onSentence: the sentence being heard changed (its index among every
 *   sentence spoken so far, and its text), for Read aloud's highlight.
 */
// maxChars: how much of the reply to speak (Read aloud speaks a whole reply).
// chunkChars: characters per clip after the opening sentence.
// lang: the reply's language when known (Read aloud detects it on the whole
// reply); otherwise each sentence's own script decides. A reply that isn't in
// the picked voice's language is read by a native voice for that language.
// rate: speaking speed for the voice ("+5%"), when not the voice's own.
// speed: the listener's speed (READ_SPEEDS), changed later with setSpeed().
export function createStreamingSpeaker({ apiBase, voice, onStart, onDone, onStop, onSentence, maxChars = MAX_SPOKEN_CHARS, chunkChars = VOICE_CHUNK_CHARS, lang, rate, speed: initialSpeed = 1 }) {
  active?.stop();
  let abort = new AbortController();
  // Every clip of the reply in order, played or not, so a skip back can
  // return to one: { text, parts (its sentences), first (index of its first
  // sentence, -1 for a line said before the reply), audio, speedAt }.
  let items = [];
  let next = 0; // the clip to play next
  let sentences = []; // every sentence given a clip, in order
  let heard = -1; // the sentence being heard
  let seekTo = null; // after a skip: { item, sentence } to start at
  let spokenLength = 0;
  let queuedChars = 0;
  let chunkCount = 0;
  let playing = false;
  let started = false;
  let finished = false;
  let stopped = false;
  let done = false;
  let ducked = false;
  let paused = false;
  let resumeWaiters = [];
  let suspended = null; // the audio context pause() suspended
  let speed = clampSpeed(initialSpeed);
  let gain = null;
  let tracker = null;
  // The pause owed before the next clip (set from how the last one ended).
  let pauseBefore = 0;
  // What's audible right now, so it can be stopped, paused, sped up or
  // turned down, and the clip it belongs to.
  let current = null;
  let currentItem = null;
  // Bumped by restart() and skip(): a clip from before it is never played.
  let generation = 0;
  // Web Audio couldn't be started here (no click yet): <audio> from now on.
  let webAudioBlocked = false;
  // Keeps the mic shut between clips (see isTTSActive in App.jsx).
  window.isTTSLoading = true;

  const sizeFor = (index) => (index === 1 ? Math.min(chunkChars, SECOND_CHUNK_CHARS) : chunkChars);

  // One clip from the server, as a blob plus (where Web Audio is used) its
  // decoded audio. A busy or briefly failing server is asked twice more
  // before the clip falls back to the browser's own voice, which often can't
  // start without a click, so the rest of a reply used to be skipped in
  // silence after its first line.
  const fetchAudio = async (text, atSpeed) => {
    const signal = abort.signal;
    const askedRate = combinedRate(rate, atSpeed);
    for (let attempt = 0; ; attempt++) {
      let res = null;
      try {
        res = await fetch(`${apiBase}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, lang: lang || detectSpeechLanguage(text) || undefined, ...(askedRate ? { rate: askedRate } : {}) }),
          signal,
        });
      } catch (err) {
        if (signal.aborted || attempt >= MAX_RETRIES) throw err;
      }
      if (res?.ok) {
        const blob = await res.blob();
        if (!blob.size) throw new Error("empty audio");
        let buffer = null;
        const ctx = audioContext();
        if (ctx && typeof blob.arrayBuffer === "function") {
          try { buffer = await decode(ctx, await blob.arrayBuffer()); } catch { buffer = null; }
        }
        let provider = "";
        try { provider = String(res.headers?.get?.("X-TTS-Provider") || ""); } catch { /* not exposed */ }
        return { blob, buffer, honorsRate: !IGNORES_RATE.test(provider) };
      }
      const retry = !res || res.status === 429 || res.status >= 500;
      if (!retry || attempt >= MAX_RETRIES || signal.aborted) throw new Error(`TTS ${res?.status}`);
      await sleep(res?.status === 429 ? 2000 * (attempt + 1) : 800 * (attempt + 1), signal);
      if (signal.aborted) throw new Error("stopped");
    }
  };

  const fetchFor = (item) => {
    item.speedAt = speed;
    item.audio = fetchAudio(item.text, speed).catch(() => null);
  };

  // The next few clips are fetched while this one plays (again, if they were
  // fetched at another speed). Clips well behind are let go; a skip back to
  // one fetches it again.
  const prefetch = () => {
    for (const item of items.slice(next, next + MAX_AHEAD)) {
      if (!item.audio || item.speedAt !== speed) fetchFor(item);
    }
    for (const item of items.slice(0, Math.max(0, next - 3))) item.audio = null;
  };

  const setVolume = () => {
    const volume = ducked ? DUCKED_VOLUME : 1;
    if (gain) { try { gain.gain.value = volume; } catch { /* closed */ } }
    if (current?.element) { try { current.element.volume = volume; } catch { /* not ours to set */ } }
  };

  const emit = (index) => {
    if (index < 0 || index === heard || index >= sentences.length) return;
    heard = index;
    try { onSentence?.(index, sentences[index]); } catch { /* the app's to handle */ }
  };

  // Which sentence is being heard, a few times a second while speaking.
  const track = () => {
    if (!currentItem || currentItem.first < 0 || !current?.progress) return;
    emit(currentItem.first + sentenceAt(currentItem.parts, current.progress()));
  };
  const startTracking = () => {
    if (tracker || !onSentence) return;
    tracker = setInterval(track, 150);
    tracker.unref?.();
  };
  const stopTracking = () => { if (tracker) { clearInterval(tracker); tracker = null; } };

  const whilePaused = () => (paused ? new Promise((resolve) => resumeWaiters.push(resolve)) : null);
  const release = () => { const waiting = resumeWaiters; resumeWaiters = []; waiting.forEach((resolve) => resolve()); };
  const unsuspend = () => {
    if (suspended) { try { suspended.resume().catch(() => {}); } catch { /* closed */ } suspended = null; }
  };

  // Web Audio: the clip without its silence, after the owed pause, from
  // `fraction` of the way through (a skip) at `clipRate`.
  const playBuffer = (buffer, { fraction = 0, clipRate = 1, serverSpeed = 1 } = {}) => new Promise((resolve) => {
    const ctx = audioContext();
    if (!gain) {
      gain = ctx.createGain();
      gain.connect(ctx.destination);
    }
    setVolume();
    const samples = buffer.getChannelData(0);
    const bounds = speechBounds(samples, buffer.sampleRate);
    const from = seekPoint(samples, buffer.sampleRate, bounds, fraction);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (source.playbackRate) source.playbackRate.value = clipRate;
    source.connect(gain);
    let ended = false;
    // Stands in for an <audio> element for the app's checks (isTTSActive,
    // stopSpeak, ducking), which look at window.currentAudio.
    const handle = {
      paused: false,
      currentTime: 0,
      pause() { finish(); },
      get volume() { return gain?.gain.value ?? 1; },
      set volume(value) { if (gain) gain.gain.value = value; },
    };
    function finish() {
      if (ended) return;
      ended = true;
      handle.paused = true;
      try { source.onended = null; source.stop(); } catch { /* not started or already over */ }
      try { source.disconnect(); } catch { /* already */ }
      if (window.currentAudio === handle) window.currentAudio = null;
      if (current === playback) current = null;
      resolve();
    }
    // Where in the clip it is: from when and where it started, at what rate.
    let anchor = { at: ctx.currentTime + pauseBefore, position: from, rate: clipRate };
    const position = () => anchor.position + Math.max(0, ctx.currentTime - anchor.at) * anchor.rate;
    const playback = {
      stop: finish,
      serverSpeed,
      progress: () => (position() - bounds.start) / Math.max(0.05, bounds.end - bounds.start),
      setRate(value) {
        anchor = { at: Math.max(ctx.currentTime, anchor.at), position: position(), rate: value };
        try { source.playbackRate.value = value; } catch { /* finished */ }
      },
      pause() {
        if (ctx.state !== "running" || typeof ctx.suspend !== "function") return;
        suspended = ctx;
        ctx.suspend().catch(() => {});
      },
      resume: unsuspend,
    };
    current = playback;
    window.currentAudio = handle;
    source.onended = finish;
    try {
      source.start(anchor.at, from, Math.max(0.05, bounds.end - from));
    } catch {
      finish();
    }
  });

  // An <audio> element: iPhones, anywhere the clip couldn't be decoded, and
  // clips that play faster or slower than the voice made them (an element
  // keeps the voice's pitch; Web Audio doesn't).
  const playBlob = (blob, { fraction = 0, clipRate = 1, serverSpeed = 1 } = {}) => new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    try { audio.preservesPitch = true; audio.playbackRate = clipRate; } catch { /* older browser */ }
    const playback = {
      element: audio,
      serverSpeed,
      stop: () => { try { audio.pause(); } catch { /* already stopped */ } end(); },
      progress: () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.currentTime / audio.duration : 0),
      setRate(value) { try { audio.playbackRate = value; } catch { /* not ours to set */ } },
      pause() { try { audio.pause(); } catch { /* already */ } },
      resume() { try { audio.play()?.catch?.(() => {}); } catch { /* gone */ } },
    };
    current = playback;
    setVolume();
    window.currentAudio = audio;
    function end() {
      URL.revokeObjectURL(url);
      if (window.currentAudio === audio) window.currentAudio = null;
      if (current === playback) current = null;
      resolve();
    }
    audio.onended = end;
    audio.onerror = end;
    if (fraction > 0) {
      const seek = () => { try { audio.currentTime = fraction * audio.duration; } catch { /* not seekable */ } };
      if (audio.readyState >= 1) seek(); else audio.onloadedmetadata = seek;
    }
    audio.play().catch(end);
  });

  // The server's voice couldn't be had for this clip: say it with the
  // browser's own voice, picked to match the chosen one. One utterance per
  // sentence (some browsers cut a long utterance off part way), all queued at
  // once so they follow each other without a wait.
  const playBrowser = (item, from = 0) => new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const sentences = item.first >= 0 ? item.parts.slice(from) : splitSentences(item.text);
    if (!synth || typeof SpeechSynthesisUtterance === "undefined" || !sentences.length) { resolve(); return; }
    const textLang = lang || detectSpeechLanguage(item.text);
    let match = null;
    try {
      // Text in another language: the browser's own voice for that language.
      const voices = synth.getVoices();
      const native = textLang && voices.find((v) => v.lang?.toLowerCase().startsWith(textLang));
      match = native || (textLang ? null : pickBrowserVoice(voices, voice));
    } catch { /* default voice */ }
    const playback = {
      stop: () => { try { synth.cancel(); } catch { /* no speech engine */ } resolve(); },
      pause: () => { try { synth.pause(); } catch { /* no speech engine */ } },
      resume: () => { try { synth.resume(); } catch { /* no speech engine */ } },
    };
    current = playback;
    sentences.forEach((sentence, i) => {
      const utterance = new SpeechSynthesisUtterance(sentence);
      if (match) utterance.voice = match;
      utterance.lang = match?.lang || textLang || describeTtsVoice(voice).lang;
      utterance.rate = speed;
      if (ducked) utterance.volume = DUCKED_VOLUME;
      if (item.first >= 0) utterance.onstart = () => emit(item.first + from + i);
      if (i === sentences.length - 1) {
        utterance.onend = () => { if (current === playback) current = null; resolve(); };
        utterance.onerror = utterance.onend;
      }
      synth.speak(utterance);
    });
  });

  // `from`: the sentence of the clip to start at (after a skip).
  const play = async (item, clip, gen, from) => {
    await whilePaused();
    if (stopped || gen !== generation) return;
    const fraction = from ? fractionBefore(item.parts, from) : 0;
    // The voice made it at the speed asked for, unless it has none of its own.
    const serverSpeed = clip?.honorsRate ? item.speedAt : 1;
    const clipRate = speed / serverSpeed;
    const options = { fraction, clipRate, serverSpeed };
    const atVoiceSpeed = Math.abs(clipRate - 1) < 0.01;
    const ctx = clip?.buffer && !webAudioBlocked && atVoiceSpeed ? audioContext() : null;
    const webAudio = ctx ? await running(ctx) : false;
    if (ctx && !webAudio) webAudioBlocked = true;
    if (stopped || gen !== generation) return;
    if (webAudio) await playBuffer(clip.buffer, options);
    // An <audio> element plays the clip's own silence, which is pause enough.
    else if (clip?.blob) await playBlob(clip.blob, options);
    else await playBrowser(item, from);
    if (gen === generation) pauseBefore = pauseAfter(item.text);
  };

  const complete = () => {
    if (done || stopped) return;
    done = true;
    stopTracking();
    window.isTTSLoading = false;
    if (active === speaker) active = null;
    onDone?.();
  };

  const pump = async () => {
    if (playing || stopped) return;
    const index = next;
    const item = items[index];
    if (!item) { if (finished) complete(); return; }
    next = index + 1;
    playing = true;
    const gen = generation;
    const from = seekTo?.item === index ? seekTo.sentence : 0;
    if (seekTo) { seekTo = null; pauseBefore = 0; }
    if (!item.audio || item.speedAt !== speed) fetchFor(item);
    prefetch();
    try {
      const clip = await item.audio;
      if (stopped || gen !== generation) return;
      if (!started) { started = true; onStart?.(); startTracking(); }
      currentItem = item;
      if (item.first >= 0) emit(item.first + from);
      await play(item, clip, gen, from);
    } finally {
      if (currentItem === item) currentItem = null;
      playing = false;
      if (!stopped) pump();
    }
  };

  const enqueue = (text) => {
    if (!text || queuedChars >= maxChars) return;
    const clipped = text.slice(0, maxChars - queuedChars);
    queuedChars += clipped.length;
    chunkCount++;
    const parts = sentencesOf(clipped).map((part) => part.trim()).filter(Boolean);
    items.push({ text: clipped, parts, first: sentences.length, audio: null, speedAt: speed });
    sentences.push(...parts);
    prefetch();
    pump();
  };

  const takeNew = (raw, everything) => {
    const full = String(raw || "");
    const opening = spokenLength === 0;
    let cut = everything ? full.length : stableCut(full);
    // Nothing has been said yet and the first sentence is long: start on its
    // first clause.
    if (!cut && opening) cut = firstClauseCut(full);
    if (!cut) return;
    const spoken = speakableText(full.slice(0, cut));
    if (spoken.length <= spokenLength) return;
    const fresh = spoken.slice(spokenLength);
    spokenLength = spoken.length;
    const offset = chunkCount;
    for (const chunk of splitSentences(fresh, { first: opening, target: (i) => sizeFor(offset + i) })) enqueue(chunk);
  };

  const silence = () => {
    abort.abort();
    items = [];
    next = 0;
    seekTo = null;
    pauseBefore = 0;
    paused = false;
    unsuspend();
    release();
    current?.stop();
    current = null;
    const audio = window.currentAudio;
    if (audio) { try { audio.pause(); } catch { /* already stopped */ } window.currentAudio = null; }
    try { window.speechSynthesis?.cancel(); } catch { /* no speech engine */ }
  };

  // Stop what's audible and go on from items[next] (a skip), keeping a
  // pause or the reply's place.
  const jump = () => {
    generation++;
    pauseBefore = 0;
    const playback = current;
    current = null;
    playback?.stop();
    if (!playing) pump();
  };

  const speaker = {
    /** The reply so far (the full accumulated text, not a delta). */
    push(raw) { if (!stopped && !finished) takeNew(raw, false); },
    /**
     * A short line of its own, before the reply ("One sec, let me check."),
     * said only if the reply hasn't started being spoken.
     */
    say(line) {
      if (stopped || finished || started || spokenLength > 0 || items.length > next) return;
      const text = speakableText(line);
      if (!text) return;
      items.push({ text, parts: [text], first: -1, audio: null, speedAt: speed });
      prefetch();
      pump();
    },
    duck(down) {
      ducked = Boolean(down);
      setVolume();
    },
    /** The reply is complete: speak whatever is left, then call onDone. */
    finish(raw) {
      if (stopped || finished) return;
      takeNew(raw, true);
      finished = true;
      if (!playing && items.length <= next) complete();
    },
    /** Hold the reading where it is; resume() carries on from there. */
    pause() {
      if (stopped || done || paused) return;
      paused = true;
      current?.pause?.();
    },
    resume() {
      if (!paused) return;
      paused = false;
      current?.resume?.();
      unsuspend();
      release();
    },
    /**
     * Go back (-1) or forward (+1) a sentence. Forward from the last
     * sentence of a finished reply ends the reading. A pause is kept.
     */
    skip(delta = 1) {
      if (stopped || done) return;
      const step = Math.trunc(Number(delta)) || 0;
      if (!step || !sentences.length) return;
      const from = heard >= 0 ? heard : Math.max(0, items[next]?.first ?? 0);
      const target = Math.max(0, from + step);
      if (target >= sentences.length) {
        if (!finished) return;
        next = items.length;
        paused = false;
        unsuspend();
        release();
        jump();
        return;
      }
      const index = items.findIndex((item) => item.first >= 0 && target >= item.first && target < item.first + item.parts.length);
      if (index < 0) return;
      seekTo = { item: index, sentence: target - items[index].first };
      next = index;
      emit(target);
      jump();
    },
    /** The listener's speed (READ_SPEEDS): the clip playing speeds up now, the rest are asked for at it. */
    setSpeed(value) {
      const wanted = clampSpeed(value);
      if (wanted === speed) return;
      speed = wanted;
      if (current?.setRate) current.setRate(speed / (current.serverSpeed || 1));
      prefetch();
    },
    /** The reply is being retried from scratch. */
    restart() {
      if (stopped) return;
      silence();
      generation++;
      abort = new AbortController();
      sentences = [];
      heard = -1;
      spokenLength = 0;
      queuedChars = 0;
      chunkCount = 0;
      started = false;
      window.isTTSLoading = true;
    },
    stop() {
      if (stopped || done) return;
      stopped = true;
      stopTracking();
      silence();
      if (gain) { try { gain.disconnect(); } catch { /* already */ } gain = null; }
      window.isTTSLoading = false;
      if (active === speaker) active = null;
      onStop?.();
    },
    get finished() { return finished || stopped; },
    get paused() { return paused; },
    get speed() { return speed; },
    /** The sentence being heard (-1 before the first), and every sentence so far. */
    get sentence() { return heard; },
    get sentences() { return sentences.slice(); },
  };
  active = speaker;
  return speaker;
}
