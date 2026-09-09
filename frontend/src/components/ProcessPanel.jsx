import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Check, X, Globe, Brain, Star, Bot, LayoutGrid, Compass, CornerDownRight, ExternalLink } from "lucide-react";
import "./ProcessPanel.css";

/**
 * Claude-style working-process panel.
 *
 * Shows what VetroAI actually *did* for a turn — analysed the request, searched
 * the web and which pages it read, which provider answered, which one failed
 * and why — alongside the model's chain of thought, instead of a bare
 * "Thinking…" spinner that hides all of it.
 *
 * Steps arrive from the backend as `step` SSE events, keyed by id so a row
 * updates in place (running → done/failed). Reasoning arrives as `reasoning`
 * events — native reasoning tokens, or a <think> block stripped out of the
 * answer. Either channel can be empty; the panel adapts.
 */

// Rendered as plain functions rather than JSX tags, so no component is created
// during render (which would reset its state on every pass).
const STEP_ICONS = {
  analyze: (p) => <Compass {...p} />,
  search: (p) => <Globe {...p} />,
  images: (p) => <LayoutGrid {...p} />,
  astro: (p) => <Star {...p} />,
  model: (p) => <Bot {...p} />,
  continue: (p) => <CornerDownRight {...p} />,
  reasoning: (p) => <Brain {...p} />,
  default: (p) => <Check {...p} />,
};

// Step ids are either plain ("search") or suffixed per attempt ("model-2").
const iconFor = (id) => STEP_ICONS[String(id).split("-")[0]] || STEP_ICONS.default;

const formatMs = (ms) => {
  if (!ms || ms < 0) return null;
  if (ms < 950) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
};

// A finished step keeps its own icon — a globe for the web search, a bot for the
// provider — which scans faster than a column of identical ticks.
function StepIcon({ state, id }) {
  if (state === "running") return <span className="vai-pp-spinner" aria-hidden="true" />;
  if (state === "failed") return <X size={11} strokeWidth={2.6} aria-hidden="true" />;
  if (state === "skipped") return <span className="vai-pp-dash" aria-hidden="true" />;
  return iconFor(id)({ size: 11, "aria-hidden": "true" });
}

/** One row of the timeline; expands to its detail line and any sources. */
function StepRow({ step }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(step.detail || (step.items && step.items.length));
  const duration = formatMs(step.ms);

  return (
    <li className={`vai-pp-step is-${step.state || "done"}${open ? " is-open" : ""}`}>
      <span className="vai-pp-bullet" aria-hidden="true">
        <StepIcon state={step.state} id={step.id} />
      </span>
      <div className="vai-pp-main">
        {expandable ? (
          <button
            type="button"
            className="vai-pp-row"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <span className="vai-pp-label">{step.label}</span>
            {duration && <span className="vai-pp-ms">{duration}</span>}
            <ChevronRight size={12} className="vai-pp-caret" aria-hidden="true" />
          </button>
        ) : (
          <div className="vai-pp-row is-static">
            <span className="vai-pp-label">{step.label}</span>
            {duration && <span className="vai-pp-ms">{duration}</span>}
          </div>
        )}

        {expandable && open && (
          <div className="vai-pp-detail">
            {step.detail && <p className="vai-pp-detail-text">{step.detail}</p>}
            {step.items && step.items.length > 0 && (
              <ul className="vai-pp-items">
                {step.items.map((item, i) => (
                  <li key={`${item.url || item.label}-${i}`}>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        <span className="vai-pp-item-label">{item.label}</span>
                        <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="vai-pp-item-label">{item.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** The chain-of-thought body, shared by the standalone and in-timeline layouts. */
function ReasoningBody({ reasoning, isThinking }) {
  const ref = useRef(null);

  // Keep the newest reasoning in view while it streams.
  useEffect(() => {
    if (!isThinking) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoning, isThinking]);

  return (
    <div className="vai-pp-reasoning" ref={ref}>
      {reasoning && reasoning.trim() ? (
        <p className="vai-pp-reasoning-text">
          {reasoning}
          {isThinking && <span className="vai-pp-cursor" aria-hidden="true" />}
        </p>
      ) : (
        <p className="vai-pp-reasoning-text is-placeholder">Working through the request…</p>
      )}
    </div>
  );
}

/** The reasoning row, rendered inline among the steps. */
function ReasoningRow({ reasoning, isThinking, durationMs }) {
  const [userOpen, setUserOpen] = useState(null);
  const open = userOpen === null ? isThinking : userOpen;
  const seconds = formatMs(durationMs);

  return (
    <li className={`vai-pp-step is-${isThinking ? "running" : "done"}${open ? " is-open" : ""}`}>
      <span className="vai-pp-bullet" aria-hidden="true">
        {isThinking ? <span className="vai-pp-spinner" /> : <Brain size={11} />}
      </span>
      <div className="vai-pp-main">
        <button
          type="button"
          className="vai-pp-row"
          onClick={() => setUserOpen(!open)}
          aria-expanded={open}
        >
          <span className="vai-pp-label">{isThinking ? "Thinking" : "Thought it through"}</span>
          {!isThinking && seconds && <span className="vai-pp-ms">{seconds}</span>}
          <ChevronRight size={12} className="vai-pp-caret" aria-hidden="true" />
        </button>
        {open && (
          <div className="vai-pp-detail">
            <ReasoningBody reasoning={reasoning} isThinking={isThinking} />
          </div>
        )}
      </div>
    </li>
  );
}

export default function ProcessPanel({
  steps = [],
  reasoning = "",
  isThinking = false,
  durationMs = null,
}) {
  // null = follow the automatic open/close behaviour; true/false = user's choice.
  const [userOpen, setUserOpen] = useState(null);

  const hasReasoning = Boolean(reasoning && reasoning.trim());
  const hasSteps = steps.length > 0;
  const isWorking = isThinking || steps.some((s) => s.state === "running");

  const open = userOpen === null ? isWorking : userOpen;

  // Wall-clock span of the recorded steps, for the collapsed summary. Every ts
  // comes from the backend, so the two are comparable.
  const workedMs = useMemo(() => {
    const stamps = steps.map((s) => s.ts).filter((t) => typeof t === "number");
    if (stamps.length < 2) return null;
    return Math.max(...stamps) - Math.min(...stamps);
  }, [steps]);

  if (!hasSteps && !hasReasoning && !isThinking) return null;

  const label = (() => {
    if (isWorking) return hasSteps ? "Working" : "Thinking";
    if (hasSteps) {
      const span = formatMs(workedMs);
      // Counts what the panel actually lists, reasoning row included.
      const rows = steps.length + (hasReasoning ? 1 : 0);
      const count = `${rows} step${rows > 1 ? "s" : ""}`;
      return span ? `Worked for ${span} · ${count}` : `Working process · ${count}`;
    }
    const span = formatMs(durationMs);
    return span ? `Thought for ${span}` : "Thought process";
  })();

  return (
    <div className={`vai-pp${isWorking ? " is-active" : ""}${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="vai-pp-header"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "Hide working process" : "Show working process"}
      >
        <ChevronRight size={13} className="vai-pp-chevron" aria-hidden="true" />
        <span className="vai-pp-spark" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5L12 3Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="vai-pp-header-label">{label}</span>
        {isWorking && (
          <span className="vai-pp-dots" aria-hidden="true">
            <i /><i /><i />
          </span>
        )}
      </button>

      <div className="vai-pp-body" hidden={!open}>
        {hasSteps ? (
          <ol className="vai-pp-steps">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
            {(hasReasoning || isThinking) && (
              <ReasoningRow
                reasoning={reasoning}
                isThinking={isThinking}
                durationMs={durationMs}
              />
            )}
          </ol>
        ) : (
          <ReasoningBody reasoning={reasoning} isThinking={isThinking} />
        )}
      </div>
    </div>
  );
}
