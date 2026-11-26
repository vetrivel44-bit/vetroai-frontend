import React, { useEffect, useState } from "react";
import { Check, ChevronDown, Mic, MicOff, X } from "lucide-react";
import "./VoiceMode.css";

// OpenAI's tts-1 voices, spoken by AI Router on the backend (/api/tts): fast,
// natural and the same voice in every language, so a reply that switches from
// English to Tamil or Hindi keeps its tone. nova is the default (initialVoice
// in App.jsx).
const VOICES = [
  { id: "nova", name: "Nova", note: "Warm and expressive", accent: "Natural" },
  { id: "shimmer", name: "Shimmer", note: "Clear and gentle", accent: "Natural" },
  { id: "alloy", name: "Alloy", note: "Even and neutral", accent: "Natural" },
  { id: "echo", name: "Echo", note: "Calm and steady", accent: "Natural" },
  { id: "fable", name: "Fable", note: "Bright storyteller", accent: "British" },
  { id: "onyx", name: "Onyx", note: "Deep and relaxed", accent: "Natural" },
];

/**
 * Full-screen voice conversation, kept deliberately quiet: a small soft
 * shape that moves differently while listening, thinking and speaking, one
 * line saying which it is, and two small controls.
 */
export default function VoiceMode({
  listening, hearing, speaking, thinking, muted,
  voice, onVoiceChange, onOrb, onMute, onClose,
}) {
  const [picking, setPicking] = useState(false);
  const current = VOICES.find((v) => v.id === voice) || VOICES[0];
  // hearing: the person is talking right now (voice mode's open microphone).
  const state = hearing ? "hearing" : speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : muted ? "muted" : "idle";

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (picking) setPicking(false); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, onClose]);

  const line = {
    hearing: "Listening",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    muted: "Microphone off",
    idle: "Tap to talk",
  }[state];

  return (
    <div className={`vm is-${state}`} role="dialog" aria-modal="true" aria-label="Voice conversation">
      <header className="vm-top">
        <button type="button" className="vm-voice" onClick={() => setPicking(true)} aria-haspopup="dialog" aria-label={`Voice: ${current.name}. Change voice`}>
          {current.name} <ChevronDown size={14} />
        </button>
        <button type="button" className="vm-icon" onClick={onClose} aria-label="End voice conversation"><X size={20} /></button>
      </header>

      <main className="vm-stage">
        <button
          type="button"
          className="vm-shape"
          onClick={onOrb}
          disabled={thinking}
          aria-label={speaking ? "Interrupt and talk" : hearing ? "Send what you said" : listening ? "Listening — just talk" : "Start talking"}
          title={speaking ? "Tap to interrupt, or just start talking" : hearing ? "Tap to send now" : listening ? "Just talk" : "Tap to talk"}
        >
          <i /><i /><i />
        </button>
        <p className="vm-line" aria-live="polite">{line}</p>
      </main>

      <footer className="vm-controls">
        <button type="button" className={`vm-btn${muted ? " is-on" : ""}`} onClick={onMute} aria-pressed={muted} aria-label={muted ? "Turn microphone on" : "Turn microphone off"} title={muted ? "Unmute" : "Mute"}>
          {muted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
        <button type="button" className="vm-btn vm-end" onClick={onClose} aria-label="End voice conversation" title="End">
          <span className="vm-stop" />
        </button>
      </footer>

      {picking && (
        <div className="vm-sheet-backdrop" onClick={() => setPicking(false)}>
          <div className="vm-sheet" role="dialog" aria-label="Choose a voice" onClick={(e) => e.stopPropagation()}>
            <div className="vm-sheet-grip" />
            <h2>Voice</h2>
            <div className="vm-voice-list">
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`vm-voice-row${v.id === current.id ? " is-selected" : ""}`}
                  onClick={() => { onVoiceChange(v.id); setPicking(false); }}
                  aria-pressed={v.id === current.id}
                >
                  <span className="vm-voice-text">
                    <strong>{v.name}</strong>
                    <small>{v.note} · {v.accent}</small>
                  </span>
                  <span className="vm-check">{v.id === current.id && <Check size={16} />}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
