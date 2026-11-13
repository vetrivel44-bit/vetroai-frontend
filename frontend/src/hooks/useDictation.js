// The composer's microphone (lib/dictation.js has the why).
//
// phase: "idle" → "starting" (asking for the mic) → "recording" →
// "transcribing" → "idle". Tap the mic to start, tap ✓ (finish) to have the
// words typed into the box, × or Escape (cancel) to throw the recording away.
//
// Nothing here re-renders the app while the person talks except the
// once-a-second timer: the live waveform is drawn straight onto the bars
// inside `meterRef`.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DICTATION_MAX_MS, DICTATION_MIN_MS, DictationError, browserRecognition, canRecord, joinRecognitionResults,
  micErrorMessage, pickRecordingType, recognitionLocale, rememberLanguage, serverDictationAvailable, transcribeRecording,
} from "../lib/dictation.js";

const METER_STEP_MS = 70;

// `getHints` returns the languages this person uses, most likely first
// (lib/dictation.js dictationHints); asked once per recording. `getLanguage`
// returns the language they picked for the microphone, or "" for Auto.
export function useDictation({ apiBase, onText, onError, onNotice, getHints, getLanguage, desktop = false }) {
  const [phase, setPhaseState] = useState("idle");
  const [elapsed, setElapsed] = useState(0);
  const [interim, setInterim] = useState("");
  const [usingBrowser, setUsingBrowser] = useState(false);
  const phaseRef = useRef("idle");
  const meterRef = useRef(null);
  const session = useRef(null);
  // Can the server type out recordings? null until it has been asked.
  const serverOk = useRef(null);
  const handlers = useRef({ onText, onError, onNotice, getHints, getLanguage });
  handlers.current = { onText, onError, onNotice, getHints, getLanguage };
  const hints = () => { try { return handlers.current.getHints?.() || []; } catch { return []; } };
  const picked = () => { try { return handlers.current.getLanguage?.() || ""; } catch { return ""; } };

  const setPhase = useCallback((next) => { phaseRef.current = next; setPhaseState(next); }, []);
  const supported = canRecord() || !!browserRecognition();

  const drawMeter = (levels) => {
    const bars = meterRef.current?.children;
    if (!bars?.length) return;
    // Newest on the right, older ones drifting left.
    for (let i = 0; i < bars.length; i++) {
      const level = levels[levels.length - bars.length + i] ?? 0;
      bars[i].style.transform = `scaleY(${Math.max(0.14, Math.min(1, level)).toFixed(3)})`;
    }
  };

  const release = useCallback((s = session.current) => {
    if (!s) return;
    clearInterval(s.timer);
    clearTimeout(s.limit);
    cancelAnimationFrame(s.raf);
    s.stream?.getTracks().forEach((track) => track.stop());
    s.audio?.close?.().catch(() => {});
    s.stream = null;
    s.audio = null;
    drawMeter([]);
  }, []);

  const end = useCallback((s) => {
    release(s);
    // A late callback from an earlier session mustn't reset a newer one.
    if (session.current && session.current !== s) return;
    session.current = null;
    setInterim("");
    setElapsed(0);
    setUsingBrowser(false);
    setPhase("idle");
  }, [release, setPhase]);

  const startClock = (s) => {
    s.startedAt = Date.now();
    let shown = -1;
    setElapsed(0);
    s.timer = setInterval(() => {
      const ms = Date.now() - s.startedAt;
      const second = Math.floor(ms / 1000);
      if (second !== shown) { shown = second; setElapsed(ms); }
    }, 200);
  };

  // ── The browser's own recognition (fallback) ─────────────────────────────
  const startBrowser = useCallback(() => {
    const Recognition = browserRecognition();
    if (!Recognition) {
      handlers.current.onError?.("Voice typing isn't available in this browser. Try Chrome, Edge or Safari.");
      setPhase("idle");
      return;
    }
    const s = { kind: "browser", final: "", interim: "" };
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    // One language only here: the one picked, else the one this person most
    // likely speaks, as a full locale ("en-IN", "ta-IN").
    recognition.lang = recognitionLocale(picked() || hints()[0] || navigator.language || "en");
    s.recognition = recognition;
    // Everything heard is shown as it comes and typed into the box once, at
    // the end. (Typing each final piece as it came repeated phrases on
    // Android, and a piece the recognizer later corrected stayed wrong.)
    recognition.onresult = (event) => {
      const { final, interim } = joinRecognitionResults(event.results);
      s.final = final;
      s.interim = interim;
      const live = [final, interim].filter(Boolean).join(" ");
      // The newest words, where the person's attention is.
      setInterim(live.length > 90 ? `…${live.slice(-90)}` : live);
    };
    recognition.onerror = (event) => {
      s.failed = event?.error;
      if (event?.error === "aborted") return;
      if (event?.error === "no-speech") handlers.current.onNotice?.("Didn't hear anything. Tap the mic and try again.");
      else handlers.current.onError?.(micErrorMessage({ name: event?.error }, { desktop }));
    };
    recognition.onend = () => {
      // Safari can stop without ever marking the last words final.
      const text = [s.final, s.interim].filter(Boolean).join(" ").trim();
      if (!s.cancelled) {
        if (text) handlers.current.onText?.(text);
        else if (!s.failed) handlers.current.onNotice?.("Didn't catch that. Try again a little closer to the mic.");
      }
      end(s);
    };
    session.current = s;
    setUsingBrowser(true);
    try {
      recognition.start();
      startClock(s);
      setPhase("recording");
    } catch (err) {
      handlers.current.onError?.(micErrorMessage(err, { desktop }));
      end(s);
    }
  }, [desktop, end, setPhase]);

  // ── Recording, typed out by the server ───────────────────────────────────
  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    if (serverOk.current === false || !canRecord()) { startBrowser(); return; }

    const s = { kind: "server", chunks: [] };
    session.current = s;
    setPhase("starting");

    // Asked once, alongside the microphone, so it adds no wait.
    if (serverOk.current === null) {
      serverDictationAvailable(apiBase).then((ok) => {
        if (ok === null) return;
        serverOk.current = ok;
        // No speech-to-text on the server: hand over to the browser's
        // recognition straight away rather than record something that
        // can't be typed out.
        if (!ok && session.current === s && !s.cancelled) {
          s.cancelled = true;
          try { s.recorder?.state !== "inactive" && s.recorder?.stop(); } catch { /* already stopped */ }
          end(s);
          startBrowser();
        }
      });
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      if (!s.cancelled) handlers.current.onError?.(micErrorMessage(err, { desktop }));
      end(s);
      return;
    }
    if (s.cancelled || session.current !== s) { stream.getTracks().forEach((track) => track.stop()); return; }
    s.stream = stream;

    const type = pickRecordingType();
    let recorder;
    try {
      recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
    } catch {
      try { recorder = new MediaRecorder(stream); } catch (err) {
        handlers.current.onError?.(micErrorMessage(err, { desktop }));
        end(s);
        return;
      }
    }
    s.recorder = recorder;
    s.type = recorder.mimeType || type || "audio/webm";
    recorder.ondataavailable = (event) => { if (event.data?.size) s.chunks.push(event.data); };

    // The live waveform.
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        s.audio = new AudioContext();
        const analyser = s.audio.createAnalyser();
        analyser.fftSize = 512;
        s.audio.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const levels = [];
        let last = 0;
        const tick = (now) => {
          if (session.current !== s || !s.audio) return;
          if (now - last >= METER_STEP_MS) {
            last = now;
            analyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v; }
            // Speech sits around 0.02–0.2 RMS; spread that over the bar.
            levels.push(Math.min(1, Math.sqrt(sum / samples.length) * 5.5));
            if (levels.length > 160) levels.shift();
            drawMeter(levels);
          }
          s.raf = requestAnimationFrame(tick);
        };
        s.raf = requestAnimationFrame(tick);
      }
    } catch { /* no meter; recording still works */ }

    recorder.start(250);
    startClock(s);
    s.limit = setTimeout(() => { if (session.current === s && phaseRef.current === "recording") finishRef.current?.(); }, DICTATION_MAX_MS);
    setPhase("recording");
  }, [apiBase, desktop, end, setPhase, startBrowser]);

  const finish = useCallback(() => {
    const s = session.current;
    if (!s || phaseRef.current !== "recording") return;
    if (s.kind === "browser") {
      try { s.recognition.stop(); } catch { end(s); }
      return;
    }
    const recorder = s.recorder;
    const tookMs = Date.now() - (s.startedAt || Date.now());
    recorder.onstop = async () => {
      release(s);
      if (s.cancelled) return;
      if (tookMs < DICTATION_MIN_MS || !s.chunks.length) {
        handlers.current.onNotice?.("Tap the mic, say your message, then tap ✓.");
        end(s);
        return;
      }
      const blob = new Blob(s.chunks, { type: s.type });
      s.chunks = [];
      setPhase("transcribing");
      s.abort = new AbortController();
      try {
        const { text, language } = await transcribeRecording(apiBase, blob, { signal: s.abort.signal, language: picked() || undefined, hints: hints() });
        if (s.cancelled) return;
        if (text) {
          rememberLanguage(language);
          handlers.current.onText?.(text);
        }
        else handlers.current.onNotice?.("Didn't catch that. Try again a little closer to the mic.");
      } catch (err) {
        if (s.cancelled || err?.code === "cancelled") return;
        if (err instanceof DictationError && err.code === "ASR_NOT_CONFIGURED") {
          serverOk.current = false;
          handlers.current.onError?.(browserRecognition()
            ? "Voice typing isn't set up on the server. Tap the mic again to use your browser's speech recognition."
            : err.message);
        } else {
          handlers.current.onError?.(err?.message || "Couldn't type out that recording. Try again.");
        }
      } finally {
        if (session.current === s) end(s);
      }
    };
    try {
      if (recorder.state === "inactive") recorder.onstop();
      else { recorder.requestData?.(); recorder.stop(); }
    } catch {
      end(s);
    }
  }, [apiBase, end, release, setPhase]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const cancel = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.cancelled = true;
    if (s.kind === "browser") {
      try { s.recognition.abort(); } catch { /* gone */ }
    } else {
      s.abort?.abort();
      try { if (s.recorder && s.recorder.state !== "inactive") s.recorder.stop(); } catch { /* gone */ }
    }
    end(s);
  }, [end]);

  // The language was changed while the browser's recognizer listens: it only
  // hears one, so start it again in the new one. (A recording for the server
  // needs nothing: the language is read when it's typed out.)
  const relisten = useCallback(() => {
    const s = session.current;
    if (!s || s.kind !== "browser" || phaseRef.current !== "recording") return;
    s.cancelled = true;
    try { s.recognition.abort(); } catch { /* gone */ }
    end(s);
    startBrowser();
  }, [end, startBrowser]);

  const toggle = useCallback(() => {
    if (phaseRef.current === "idle") start();
    else if (phaseRef.current === "recording") finish();
    else if (phaseRef.current === "starting") cancel();
  }, [start, finish, cancel]);

  // Escape throws the recording away.
  useEffect(() => {
    if (phase !== "recording" && phase !== "starting" && phase !== "transcribing") return undefined;
    const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, cancel]);

  // Leaving the page mid-recording lets go of the microphone.
  useEffect(() => () => {
    const s = session.current;
    if (!s) return;
    s.cancelled = true;
    try { s.recognition?.abort(); } catch { /* gone */ }
    try { if (s.recorder && s.recorder.state !== "inactive") s.recorder.stop(); } catch { /* gone */ }
    s.abort?.abort();
    release(s);
  }, [release]);

  return { phase, elapsed, interim, usingBrowser, supported, meterRef, start, finish, cancel, toggle, relisten };
}
