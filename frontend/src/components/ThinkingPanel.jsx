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
export default function ThinkingPanel({
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

  return (
    <div className={`vai-tp${isThinking ? " is-active" : ""}${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="vai-tp-header"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "Hide thinking process" : "Show thinking process"}
      >
        <ChevronRight size={13} className="vai-tp-chevron" aria-hidden="true" />
        <span className="vai-tp-spark" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5L12 3Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="vai-tp-label">{label}</span>
        {isThinking && (
          <span className="vai-tp-dots" aria-hidden="true">
            <i /><i /><i />
          </span>
        )}
      </button>

      <div className="vai-tp-body-wrap" hidden={!open}>
        <div className="vai-tp-body" ref={bodyRef}>
          {hasReasoning ? (
            <p className="vai-tp-text">
              {reasoning}
              {isThinking && <span className="vai-tp-caret" aria-hidden="true" />}
            </p>
          ) : (
            <p className="vai-tp-text vai-tp-placeholder">Working through the request…</p>
          )}
        </div>
      </div>
    </div>
  );
}
