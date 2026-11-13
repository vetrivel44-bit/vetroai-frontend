import React, { useEffect, useState } from "react";
import { Check, ChevronDown, Mic, MicOff, X } from "lucide-react";
import "./VoiceMode.css";

// Every option is free: "…Neural" voices are Microsoft Edge's neural voices and
// "google-…" voices are Google's free voice, both spoken by the backend's /tts.
// The first four are Microsoft's newer conversational voices, the most like a
// person talking; Ava is the default (initialVoice in App.jsx).
// "sarvam-…" voices are the Premium ones: Sarvam's Bulbul, paid, made for
// Indian English, and the same voice reads Tamil, Hindi and nine other Indian
// languages (backend sarvamTtsService.js).
const VOICES = [
  { id: "sarvam-ishita", name: "Ishita", note: "Natural and expressive", accent: "India", premium: true },
  { id: "sarvam-ratan", name: "Ratan", note: "Warm and clear", accent: "India", premium: true },
  { id: "sarvam-priya", name: "Priya", note: "Friendly and bright", accent: "India", premium: true },
  { id: "sarvam-shubh", name: "Shubh", note: "Calm and steady", accent: "India", premium: true },
  { id: "en-US-AvaMultilingualNeural", name: "Ava", note: "Warm and expressive", accent: "US" },
  { id: "en-US-AndrewMultilingualNeural", name: "Andrew", note: "Relaxed and genuine", accent: "US" },
  { id: "en-US-EmmaMultilingualNeural", name: "Emma", note: "Cheerful and chatty", accent: "US" },
  { id: "en-US-BrianMultilingualNeural", name: "Brian", note: "Casual and easygoing", accent: "US" },
  { id: "en-US-JennyNeural", name: "Jenny", note: "Warm and friendly", accent: "US" },
  { id: "en-US-AriaNeural", name: "Aria", note: "Bright and expressive", accent: "US" },
  { id: "en-US-GuyNeural", name: "Guy", note: "Calm and steady", accent: "US" },
  { id: "en-US-SteffanNeural", name: "Steffan", note: "Clear and confident", accent: "US" },
  { id: "en-GB-SoniaNeural", name: "Sonia", note: "Polished and gentle", accent: "UK" },
  { id: "en-GB-RyanNeural", name: "Ryan", note: "Relaxed and easygoing", accent: "UK" },
  { id: "en-IN-NeerjaNeural", name: "Neerja", note: "Clear and cheerful", accent: "India" },
  { id: "en-IN-PrabhatNeural", name: "Prabhat", note: "Calm and clear", accent: "India" },
  { id: "en-AU-NatashaNeural", name: "Natasha", note: "Bright and easy", accent: "Australia" },
  { id: "en-AU-WilliamNeural", name: "William", note: "Easygoing", accent: "Australia" },
  // Google's free voice is the same whatever the accent, so it is one option.
  { id: "google-en-US", name: "Google", note: "Google's free voice", accent: "US" },
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
                    <strong>{v.name}{v.premium && <span className="vm-premium">Premium</span>}</strong>
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
