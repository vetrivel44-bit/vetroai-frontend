import React, { useEffect, useState } from "react";
import { ArrowUp, Check, ChevronDown, Mic, MicOff, Square, X } from "lucide-react";
import "./VoiceMode.css";

const VOICES = [
  { id: "en-US-JennyNeural", name: "Jenny", note: "Warm and friendly", accent: "US", hue: 168 },
  { id: "en-US-AriaNeural", name: "Aria", note: "Bright and expressive", accent: "US", hue: 300 },
  { id: "en-US-GuyNeural", name: "Guy", note: "Calm and steady", accent: "US", hue: 215 },
  { id: "en-US-SteffanNeural", name: "Steffan", note: "Clear and confident", accent: "US", hue: 255 },
  { id: "en-GB-SoniaNeural", name: "Sonia", note: "Polished and gentle", accent: "UK", hue: 25 },
  { id: "en-GB-RyanNeural", name: "Ryan", note: "Relaxed and easygoing", accent: "UK", hue: 45 },
];

// Markdown and links read badly as a caption.
const plain = (text) => String(text || "")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/[#*_`>|]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const tail = (text, max) => (text.length > max ? `…${text.slice(text.length - max).replace(/^\S*\s/, "")}` : text);
const head = (text, max) => (text.length > max ? `${text.slice(0, max).replace(/\s\S*$/, "")}…` : text);

/**
 * Full-screen voice conversation: an orb that shows whether VetroAI is
 * listening, thinking or speaking, a live caption of what you are saying or
 * what it is saying, and call-style controls.
 */
export default function VoiceMode({
  listening, speaking, thinking, muted, transcript, reply, status,
  voice, onVoiceChange, onOrb, onMute, onClose,
}) {
  const [picking, setPicking] = useState(false);
  const current = VOICES.find((v) => v.id === voice) || VOICES[0];
  const state = speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : muted ? "muted" : "idle";

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (picking) setPicking(false); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, onClose]);

  const said = plain(transcript);
  const answer = plain(reply);
  const title = {
    listening: said ? "Listening" : "Go ahead, I'm listening",
    thinking: "Thinking",
    speaking: `${current.name} is speaking`,
    muted: "Microphone off",
    idle: "Tap the orb to talk",
  }[state];
  const caption = state === "listening" ? tail(said, 140)
    : state === "speaking" ? head(answer, 180)
    : state === "thinking" ? (status || "Working on it")
    : state === "muted" ? "Tap the mic to talk again"
    : "";
  const hint = { listening: "Tap the orb to send", speaking: "Tap the orb to interrupt", thinking: "", muted: "", idle: "" }[state];

  const primary = speaking
    ? { label: "Interrupt", icon: <Square size={18} fill="currentColor" /> }
    : listening
      ? { label: "Send", icon: <ArrowUp size={22} /> }
      : { label: "Talk", icon: <Mic size={22} /> };

  return (
    <div className={`vm is-${state}`} role="dialog" aria-modal="true" aria-label="Voice conversation" style={{ "--vm-hue": current.hue }}>
      <div className="vm-ambient" aria-hidden="true" />

      <header className="vm-top">
        <button type="button" className="vm-voice-chip" onClick={() => setPicking(true)} aria-haspopup="dialog">
          <span className="vm-avatar" style={{ "--h": current.hue }}>{current.name[0]}</span>
          <span className="vm-voice-text"><strong>{current.name}</strong><small>{current.note} · {current.accent}</small></span>
          <ChevronDown size={16} />
        </button>
      </header>

      <main className="vm-stage">
        <button
          type="button"
          className="vm-orb-wrap"
          onClick={onOrb}
          disabled={thinking}
          aria-label={speaking ? "Interrupt and talk" : listening ? "Send what you said" : "Start talking"}
        >
          <span className="vm-halo" aria-hidden="true" />
          <span className="vm-orb" aria-hidden="true"><i /><i /><i /></span>
        </button>

        <div className="vm-status" aria-live="polite">
          <div className="vm-title">
            {state === "listening" && <span className="vm-bars" aria-hidden="true"><i /><i /><i /><i /></span>}
            {state === "thinking" && <span className="vm-dots" aria-hidden="true"><i /><i /><i /></span>}
            {title}
          </div>
          <p className={`vm-caption${state === "listening" && said ? " is-you" : ""}`}>{caption}</p>
          {hint && <div className="vm-hint">{hint}</div>}
        </div>
      </main>

      <footer className="vm-controls">
        <button type="button" className={`vm-round${muted ? " is-on" : ""}`} onClick={onMute} aria-pressed={muted} aria-label={muted ? "Turn microphone on" : "Turn microphone off"}>
          {muted ? <MicOff size={20} /> : <Mic size={20} />}
          <span>{muted ? "Unmute" : "Mute"}</span>
        </button>
        <button type="button" className="vm-primary" onClick={onOrb} disabled={thinking} aria-label={primary.label}>
          {primary.icon}
          <span>{thinking ? "Thinking" : primary.label}</span>
        </button>
        <button type="button" className="vm-round vm-end" onClick={onClose} aria-label="End voice conversation">
          <X size={20} />
          <span>End</span>
        </button>
      </footer>

      {picking && (
        <div className="vm-sheet-backdrop" onClick={() => setPicking(false)}>
          <div className="vm-sheet" role="dialog" aria-label="Choose a voice" onClick={(e) => e.stopPropagation()}>
            <div className="vm-sheet-grip" />
            <h2>Choose a voice</h2>
            <p>Used for every reply VetroAI reads out loud.</p>
            <div className="vm-voice-list">
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`vm-voice-row${v.id === current.id ? " is-selected" : ""}`}
                  onClick={() => { onVoiceChange(v.id); setPicking(false); }}
                  aria-pressed={v.id === current.id}
                >
                  <span className="vm-avatar" style={{ "--h": v.hue }}>{v.name[0]}</span>
                  <span className="vm-voice-text"><strong>{v.name}</strong><small>{v.note}</small></span>
                  <span className="vm-accent">{v.accent}</span>
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
