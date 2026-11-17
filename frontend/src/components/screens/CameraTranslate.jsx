import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ImageUp, MessageSquare, RotateCcw, ScanText, SwitchCamera, Volume2, X } from "lucide-react";
import { LENS_LANGUAGES, askAboutPhoto, defaultTarget, fileToSnapshot, readPhoto, saveTarget, savedTarget, snapshot } from "../../lib/lens";
import { speakText, stopSpeaking } from "../../lib/tts";
import { freeReadAloudVoice } from "../../lib/voiceStream";
import "./CameraTranslate.css";

const nameOf = (code) => (LENS_LANGUAGES.find(([c]) => c === code) || LENS_LANGUAGES[0])[2];

/**
 * Camera translate (lib/lens.js): point the phone at a sign, menu, form or
 * label and tap the shutter (or pick a photo). The server reads the text and
 * translates it into your language, with what it means; then it can be read
 * aloud, copied, or taken to the chat to ask more.
 */
export default function CameraTranslate({ apiBase, onClose, onAsk }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const [facing, setFacing] = useState("environment");
  const [camera, setCamera] = useState("starting"); // starting | live | denied | none
  const [phase, setPhase] = useState("aim"); // aim | reading | result | error
  const [photo, setPhoto] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(() => defaultTarget({
    saved: savedTarget(),
    languages: typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : [],
  }));
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  // The back camera, while the screen is open; let go of it on close.
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamera("none"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setCamera("live");
      } catch (err) {
        if (!cancelled) setCamera(/NotAllowed|Security|Permission/i.test(String(err?.name || "")) ? "denied" : "none");
      }
    };
    Promise.resolve().then(start);
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [facing]);

  useEffect(() => () => { abortRef.current?.abort(); stopSpeaking(); }, []);

  const translate = async (image, into = target) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    stopSpeaking();
    setPhoto(image);
    setPhase("reading");
    setResult(null);
    setError("");
    setShowOriginal(false);
    setCopied(false);
    try {
      const data = await readPhoto(apiBase, image, into, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(data);
      setPhase("result");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err?.message || "Couldn't read that photo. Try again.");
      setPhase("error");
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    translate(snapshot(video));
  };

  const pickFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      translate(await fileToSnapshot(file));
    } catch (err) {
      setError(err?.message || "That file isn't a photo the app can read.");
      setPhase("error");
    }
  };

  const retake = () => {
    abortRef.current?.abort();
    stopSpeaking();
    setPhoto(null);
    setResult(null);
    setError("");
    setPhase("aim");
  };

  const changeTarget = (code) => {
    setTarget(code);
    saveTarget(code);
    // Already read: read it again into the new language.
    if (photo && phase !== "aim") translate(photo, code);
  };

  const readAloud = () => {
    const words = result?.translation || result?.explanation;
    if (words) speakText(words, { voice: freeReadAloudVoice(target) });
  };

  const copy = async () => {
    const words = [result?.translation, result?.explanation].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(words);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };

  // Escape closes; Space or Enter takes the photo.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.("select, input, textarea")) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if ((e.key === " " || e.key === "Enter") && phase === "aim" && camera === "live") { e.preventDefault(); capture(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const hasText = Boolean(result?.text);
  const sameLanguage = result && result.translation === result.text;

  return (
    <div className="ct-screen" role="dialog" aria-label="Camera translate">
      <div className="ct-stage">
        <video ref={videoRef} className={`ct-video${camera === "live" && !photo ? "" : " is-hidden"}`} playsInline muted autoPlay aria-hidden="true" />
        {photo && <img className="ct-photo" src={photo} alt="The photo being read" />}
        {phase === "reading" && <div className="ct-scan" aria-hidden="true"><span /></div>}

        {!photo && camera !== "live" && (
          <div className="ct-nocam">
            <ScanText size={34} aria-hidden="true" />
            <p>
              {camera === "starting" ? "Starting the camera…"
                : camera === "denied" ? "Allow camera access for this site to translate what you point at, or choose a photo."
                  : "No camera here. Choose a photo of a sign, menu or form to translate."}
            </p>
            {camera !== "starting" && <button type="button" className="ct-pill" onClick={() => fileRef.current?.click()}><ImageUp size={16} /> Choose a photo</button>}
          </div>
        )}
      </div>

      <header className="ct-top">
        <button type="button" className="ct-round" onClick={onClose} aria-label="Close camera translate"><X size={20} /></button>
        <label className="ct-lang">
          <span>Into {nameOf(target)}</span>
          <ChevronDown size={15} aria-hidden="true" />
          <select value={target} onChange={(e) => changeTarget(e.target.value)} aria-label="Translate into">
            {LENS_LANGUAGES.map(([code, native, english]) => (
              <option key={code} value={code}>{native === english ? english : `${native} · ${english}`}</option>
            ))}
          </select>
        </label>
        <span className="ct-round ct-spacer" aria-hidden="true" />
      </header>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />

      {phase === "aim" && camera === "live" && (
        <footer className="ct-controls">
          <p className="ct-hint">Point at a sign, menu, form or label</p>
          <div className="ct-row">
            <button type="button" className="ct-round ct-side" onClick={() => fileRef.current?.click()} aria-label="Choose a photo"><ImageUp size={21} /></button>
            <button type="button" className="ct-shutter" onClick={capture} disabled={camera !== "live"} aria-label="Take the photo and translate it"><span /></button>
            <button type="button" className="ct-round ct-side" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} disabled={camera !== "live"} aria-label="Switch camera"><SwitchCamera size={21} /></button>
          </div>
        </footer>
      )}

      {phase === "reading" && (
        <footer className="ct-controls">
          <p className="ct-status" role="status"><span className="ct-spinner" aria-hidden="true" /> Reading and translating…</p>
          <div className="ct-row"><button type="button" className="ct-pill" onClick={retake}>Cancel</button></div>
        </footer>
      )}

      {phase === "error" && (
        <section className="ct-sheet" role="alert">
          <p className="ct-error">{error}</p>
          <div className="ct-actions">
            <button type="button" className="ct-action is-main" onClick={retake}><RotateCcw size={16} /> Try again</button>
            {photo && <button type="button" className="ct-action" onClick={() => translate(photo)}>Read it again</button>}
          </div>
        </section>
      )}

      {phase === "result" && result && (
        <section className="ct-sheet" aria-live="polite">
          <div className="ct-sheet-handle" aria-hidden="true" />
          <div className="ct-from">
            {hasText ? `${result.language || "Text"} → ${result.targetName || nameOf(target)}` : "No text in this photo"}
          </div>
          {hasText && <p className={`ct-translation${sameLanguage ? " is-same" : ""}`}>{result.translation}</p>}
          {result.explanation && <p className="ct-explanation">{result.explanation}</p>}
          {hasText && !sameLanguage && (
            <div className="ct-original">
              <button type="button" className="ct-original-toggle" onClick={() => setShowOriginal((v) => !v)} aria-expanded={showOriginal}>
                {showOriginal ? "Hide" : "Show"} the original {result.language ? `(${result.language})` : "text"}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {showOriginal && <p className="ct-original-text" lang="">{result.text}</p>}
            </div>
          )}
          <div className="ct-actions">
            <button type="button" className="ct-action" onClick={readAloud}><Volume2 size={16} /> Read aloud</button>
            <button type="button" className="ct-action" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}</button>
            {onAsk && <button type="button" className="ct-action" onClick={() => onAsk(askAboutPhoto(result))}><MessageSquare size={16} /> Ask VetroAI</button>}
            <button type="button" className="ct-action is-main" onClick={retake}><RotateCcw size={16} /> New photo</button>
          </div>
        </section>
      )}
    </div>
  );
}
