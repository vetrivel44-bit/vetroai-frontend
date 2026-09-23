import React, { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import "./ThinkingPanel.css";

/**
 * Claude-style reasoning panel.
 *
 * Shows the model's chain of thought as it streams, then collapses itself into a
 * "Thought for Ns" summary once the answer starts. Reasoning arrives from the
 * backend as `reasoning` SSE events — either native reasoning tokens from the
 * provider or the contents of a <think> block stripped out of the answer.
 */
// Memoized: the chat feed re-renders on every streamed token, and every message
// that carries reasoning would otherwise re-render its whole panel each time.
// All props are primitives, so the default shallow comparison is exact.
const ThinkingPanel = React.memo(function ThinkingPanel({
  reasoning = "",
  isThinking = false,
  durationMs = null,
}) {
  // null = follow the automatic open/close behaviour; true/false = user's choice.
  const [userOpen, setUserOpen] = useState(null);
  const bodyRef = useRef(null);

  const open = userOpen === null ? isThinking : userOpen;
  const hasReasoning = Boolean(reasoning && reasoning.trim());

  // Keep the newest reasoning in view while it streams.
  useEffect(() => {
    if (!open || !isThinking) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoning, open, isThinking]);

  if (!hasReasoning && !isThinking) return null;

  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null;
  const label = isThinking
    ? "Thinking"
    : seconds
      ? `Thought for ${seconds}s`
      : "Thought process";

  // Claude / Copilot style: a quiet text line, not a pill — "Thought for 2s ›".
  // While the model is still reasoning the label shimmers ("Thinking…").
  return (
    <div className={`vai-tp${isThinking ? " is-active" : ""}${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="vai-tp-header"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "Hide thinking process" : "Show thinking process"}
      >
        <span className="vai-tp-label">{isThinking ? "Thinking…" : label}</span>
        <ChevronRight size={15} strokeWidth={2} className="vai-tp-chevron" aria-hidden="true" />
      </button>

      <div className="vai-tp-body-wrap" hidden={!open}>
        <div className="vai-tp-body" ref={bodyRef}>
          {hasReasoning ? (
            <p className="vai-tp-text">{reasoning}</p>
          ) : (
            <p className="vai-tp-text vai-tp-placeholder">Working through the request…</p>
          )}
        </div>
      </div>
    </div>
  );
});

export default ThinkingPanel;
