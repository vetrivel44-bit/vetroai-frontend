// Voice mode's ears: one open microphone for the whole conversation.
//
// Voice mode used to listen through the browser's speech recognition, one
// phrase at a time: the mic was shut while VetroAI talked (so you couldn't
// cut in), every restart beeped on Android, Firefox and the desktop app had
// none, and it heard one language. Now the app keeps the microphone open,
// notices when you start and stop talking (an energy detector that learns the
// room's noise), keeps the half second before you started so first words
// aren't clipped, and hands each thing you say over as audio for the server
// to write down (POST /api/transcribe, Whisper, any language).
//
// While VetroAI is speaking it listens harder to be sure it's you and not
// its own voice from the speaker (the browser's echo cancellation removes
// most of that); voice mode turns VetroAI down when you start and decides
// once it knows what you said.

const FRAME_MS_HINT = 43;          // 2048 samples at 48 kHz
const PREROLL_MS = 450;            // kept from before speech is detected
const ONSET_MS = 160;              // this much speech starts an utterance
const ONSET_MS_WHILE_SPEAKING = 320;
const END_SILENCE_MS = 750;        // a pause this long ends what you said…
const END_SILENCE_SHORT_MS = 1000; // …or this long after only a word or two
const MIN_SPEECH_MS = 280;         // shorter than this is a click or a cough
const MAX_UTTERANCE_MS = 60000;
const CALIBRATE_MS = 300;          // the room's noise is measured first
const TARGET_RATE = 16000;         // what Whisper works at

/** Loudness of a block of samples in dBFS (-100 for silence). */
export function levelDb(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/**
 * The speech detector, fed one loudness reading per audio frame. Pure, so it
 * can be tested without a microphone.
 *
 * feed(db, { frameMs, assistantSpeaking }) returns one of:
 *   null      nothing changed
 *   "start"   speech began (the frames since the pre-roll belong to it)
 *   "end"     what was said is over; take the utterance
 *   "cancel"  it was too short to be speech; drop it
 */
export function createVad({ onsetMs = ONSET_MS, onsetWhileSpeakingMs = ONSET_MS_WHILE_SPEAKING } = {}) {
  let noise = -60;
  let calibratingMs = CALIBRATE_MS;
  let quietest = 0;
  let speaking = false;
  let aboveMs = 0;
  let voicedMs = 0;
  let silentMs = 0;
  let lengthMs = 0;

  const threshold = (assistantSpeaking) => Math.max(noise + (assistantSpeaking ? 20 : 12), assistantSpeaking ? -44 : -52);

  return {
    get speaking() { return speaking; },
    get noiseFloor() { return noise; },
    feed(db, { frameMs = FRAME_MS_HINT, assistantSpeaking = false } = {}) {
      // First, the room: the quietest moment of the first 300 ms is its
      // noise, so a fan or traffic isn't taken for someone talking.
      if (calibratingMs > 0) {
        quietest = Math.min(quietest, db);
        calibratingMs -= frameMs;
        if (calibratingMs <= 0) noise = Math.max(-80, Math.min(-30, quietest));
        return null;
      }
      const limit = threshold(assistantSpeaking);
      if (!speaking) {
        // The room's noise: falls quickly, rises more slowly, so speech
        // doesn't teach the detector that speech is noise.
        if (db < noise) noise = Math.max(-80, noise + (db - noise) * 0.5);
        else noise = Math.min(-30, noise + (db - noise) * 0.05);
        aboveMs = db > limit ? aboveMs + frameMs : 0;
        if (aboveMs >= (assistantSpeaking ? onsetWhileSpeakingMs : onsetMs)) {
          speaking = true;
          voicedMs = aboveMs;
          silentMs = 0;
          lengthMs = aboveMs;
          aboveMs = 0;
          return "start";
        }
        return null;
      }
      lengthMs += frameMs;
      // A little below the start threshold still counts as talking.
      if (db > limit - 6) { voicedMs += frameMs; silentMs = 0; } else silentMs += frameMs;
      const pause = voicedMs < 1000 ? END_SILENCE_SHORT_MS : END_SILENCE_MS;
      if (silentMs >= pause || lengthMs >= MAX_UTTERANCE_MS) {
        speaking = false;
        const enough = voicedMs >= MIN_SPEECH_MS;
        voicedMs = 0; silentMs = 0; lengthMs = 0;
        return enough ? "end" : "cancel";
      }
      return null;
    },
    /** End now (a tap on the shape): "end" if there was speech, else "cancel". */
    flush() {
      if (!speaking) return null;
      speaking = false;
      const enough = voicedMs >= MIN_SPEECH_MS;
      voicedMs = 0; silentMs = 0; lengthMs = 0;
      return enough ? "end" : "cancel";
    },
    reset() { speaking = false; aboveMs = 0; voicedMs = 0; silentMs = 0; lengthMs = 0; },
  };
}

/** Joins Float32 frames and resamples them to `to` Hz (averaging, which also smooths). */
export function downsample(frames, from, to = TARGET_RATE) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const input = new Float32Array(total);
  let offset = 0;
  for (const f of frames) { input.set(f, offset); offset += f.length; }
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : input[start] || 0;
  }
  return out;
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples, sampleRate = TARGET_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const words = (text) => String(text || "").toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}']+/gu) || [];

/**
 * Is what the mic heard just VetroAI's own voice coming back from the
 * speaker? True when nearly every word heard is in what was being said.
 */
export function looksLikeEcho(heard, spoken) {
  const said = new Set(words(spoken));
  const got = words(heard);
  if (!got.length) return true;
  if (!said.size) return false;
  const inSpoken = got.filter((w) => said.has(w)).length;
  return inSpoken / got.length >= 0.75;
}

/** Can this browser run the listener? */
export function canListen(win = globalThis.window) {
  return Boolean(win?.navigator?.mediaDevices?.getUserMedia && (win.AudioContext || win.webkitAudioContext));
}

/**
 * Opens the microphone and calls back as the person talks.
 *   onSpeechStart()        they started talking
 *   onSpeechCancel()       it was a click or a cough after all
 *   onUtterance(wavBlob)   what they said, as 16 kHz WAV
 *   onError(err)           the microphone couldn't be opened or was lost
 *   isAssistantSpeaking()  whether VetroAI is talking right now
 * Returns { start(), stop(), pause(), resume(), flush(), get open, get paused }.
 */
export function createVoiceListener({ onSpeechStart, onSpeechCancel, onUtterance, onError, isAssistantSpeaking = () => false } = {}) {
  let stream = null;
  let context = null;
  let source = null;
  let processor = null;
  let sink = null;
  let paused = false;
  let starting = null;
  const vad = createVad();
  let preroll = [];
  let prerollMs = 0;
  let utterance = null;

  const take = (frames, rate) => {
    if (!frames?.length) return;
    try { onUtterance?.(encodeWav(downsample(frames, rate))); } catch (err) { onError?.(err); }
  };

  const onFrame = (event) => {
    if (paused || !context) return;
    const data = event.inputBuffer.getChannelData(0);
    const frame = new Float32Array(data);
    const frameMs = (frame.length / context.sampleRate) * 1000;
    const result = vad.feed(levelDb(frame), { frameMs, assistantSpeaking: Boolean(isAssistantSpeaking()) });
    if (utterance) utterance.push(frame);
    else {
      preroll.push(frame);
      prerollMs += frameMs;
      while (prerollMs > PREROLL_MS && preroll.length > 1) prerollMs -= (preroll.shift().length / context.sampleRate) * 1000;
    }
    if (result === "start") {
      utterance = preroll;
      preroll = [];
      prerollMs = 0;
      onSpeechStart?.();
    } else if (result === "end") {
      const frames = utterance;
      utterance = null;
      take(frames, context.sampleRate);
    } else if (result === "cancel") {
      utterance = null;
      onSpeechCancel?.();
    }
  };

  const release = () => {
    try { processor && (processor.onaudioprocess = null); } catch { /* gone */ }
    try { source?.disconnect(); processor?.disconnect(); sink?.disconnect(); } catch { /* gone */ }
    stream?.getTracks().forEach((track) => track.stop());
    context?.close?.().catch(() => {});
    stream = null; context = null; source = null; processor = null; sink = null;
    utterance = null; preroll = []; prerollMs = 0;
    vad.reset();
  };

  const listener = {
    get open() { return Boolean(stream); },
    get paused() { return paused; },
    get hearing() { return Boolean(utterance); },
    /** Opens the mic. Call from a tap, so the audio can start. */
    async start() {
      if (stream) { paused = false; return; }
      if (starting) return starting;
      starting = (async () => {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        // Created inside the tap that opened voice mode, before any await,
        // so mobile browsers let it run.
        context = new AudioContext();
        const ctx = context;
        try {
          const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
          if (context !== ctx) { media.getTracks().forEach((t) => t.stop()); return; }
          stream = media;
          if (ctx.state === "suspended") await ctx.resume().catch(() => {});
          source = ctx.createMediaStreamSource(media);
          processor = ctx.createScriptProcessor(2048, 1, 1);
          processor.onaudioprocess = onFrame;
          // The processor only runs when connected to the output; a silent
          // gain keeps the microphone out of the speakers.
          sink = ctx.createGain();
          sink.gain.value = 0;
          source.connect(processor);
          processor.connect(sink);
          sink.connect(ctx.destination);
          paused = false;
          media.getAudioTracks()[0]?.addEventListener("ended", () => { release(); onError?.(Object.assign(new Error("The microphone was disconnected."), { name: "NotFoundError" })); });
        } catch (err) {
          release();
          throw err;
        }
      })().finally(() => { starting = null; });
      return starting;
    },
    /** Lets go of the microphone entirely. */
    stop() { paused = false; release(); },
    /** Stops listening (mute) without closing anything. */
    pause() { paused = true; utterance = null; vad.reset(); },
    resume() { paused = false; },
    /** Treat what has been said so far as finished (a tap on the shape). */
    flush() {
      const result = vad.flush();
      if (!context) return;
      if (result === "end") { const frames = utterance; utterance = null; take(frames, context.sampleRate); }
      else if (result === "cancel") { utterance = null; onSpeechCancel?.(); }
    },
  };
  return listener;
}
