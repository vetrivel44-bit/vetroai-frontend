import React from "react";

// The two modes at the top of VetroAI, as one switch: Chat (answers, with
// Jobs, News and web search beside it) and Computer (does the work).
export default function ModeSwitch({ mode, onChat, onComputer, className = "" }) {
  return (
    <div className={`vetro-mode-switch is-${mode} ${className}`} role="tablist" aria-label="Mode">
      <span className="vetro-mode-thumb" aria-hidden="true" />
      <button type="button" role="tab" aria-selected={mode === "chat"} className={mode === "chat" ? "is-on" : ""} onClick={() => mode !== "chat" && onChat?.()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        <span>Chat</span>
      </button>
      <button type="button" role="tab" aria-selected={mode === "computer"} className={mode === "computer" ? "is-on" : ""} onClick={() => mode !== "computer" && onComputer?.()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
        <span>Computer</span>
      </button>
    </div>
  );
}
