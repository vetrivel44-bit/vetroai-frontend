import React, { useEffect, useId, useRef, useState } from "react";
import { Brain, ChevronRight, Globe } from "lucide-react";
import { summarizeReasoning } from "../utils/activityLabel";
import { sourceDomain } from "../lib/sources";
import SourceFavicon from "./SourceFavicon";
import "./ResponseProcess.css";

// How long a step's label stays up before the next replaces it. A fast model
// searched, thought and started answering in about a second, so the line at
// the top flicked past faster than anyone could read it.
const MIN_LABEL_MS = 1200;
// Results listed under the search step before "N more".
const SHOWN_RESULTS = 5;

// The model's own notes can say "I think a small comparison_table with…":
// thinking aloud in its own jargon, not a line to show anyone. A summary is
// shown only when it reads like a plain description of the work.
const ROUGH = /[_{}<>`#|\\[\]=]|\b(?:json|markdown|block|blocks|token|tokens|prompt|system|tool|the user|user's|citation|cite|format(?:ting)?|chartjs|mermaid|comparison table|i think|i should|i'll|i need|i will|i must|maybe|hmm|okay|wait)\b|^(?:i|we|so|ok)\b/i;
const cleanSummary = (text) => {
  const line = String(text || "").trim();
  return line && line.length >= 8 && !ROUGH.test(line) ? line : "";
};

// The thinking itself, tidied for reading: "comparison_table" → "comparison table".
const readable = (text) => String(text || "").replace(/\b([a-z]+)_([a-z_]+)\b/gi, (m) => m.replace(/_/g, " "));

/** `label`, changed no faster than once every `minMs`, so every step can be read. */
function useSteadyLabel(label, minMs = MIN_LABEL_MS) {
  const [shown, setShown] = useState(label);
  const since = useRef(0);
  useEffect(() => { since.current = Date.now(); }, []);
  useEffect(() => {
    if (label === shown) return undefined;
    const wait = Math.max(0, minMs - (Date.now() - since.current));
    const timer = setTimeout(() => { setShown(label); since.current = Date.now(); }, wait);
    return () => clearTimeout(timer);
  }, [label, shown, minMs]);
  return shown;
}

// How recently a result was published, in the fewest honest words.
const freshness = (value) => {
  const t = Date.parse(value || "");
  if (Number.isNaN(t)) return "";
  const hours = (Date.now() - t) / 3600000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  if (hours < 24 * 7) return `${Math.round(hours / 24)}d ago`;
  return new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
};

/**
 * What VetroAI did before answering, the way Claude shows it: one quiet line
 * above the reply saying what it's doing now ("Searching the web", "Reading
 * 10 results", "Thinking"), each step up long enough to read, ending as
 * "Thought for 4s · Searched the web". Tapping it opens the steps: the
 * search (the query and the results it found) and the thinking.
 */
const ResponseProcess = React.memo(function ResponseProcess({
  reasoning = "",
  isThinking = false,
  durationMs = null,
  searchQuery = "",
  sources = null,
  searching = false,
  live = false,
  answering = false,
}) {
  const [open, setOpen] = useState(false);
  // How long it worked, timed here when there's no reasoning time to show.
  const [startedAt] = useState(() => (live ? Date.now() : null));
  const [elapsed, setElapsed] = useState(null);
  const [allResults, setAllResults] = useState(false);
  const thinkRef = useRef(null);
  const bodyId = useId();
  const results = (sources || []).map((s, i) => ({ ...s, n: i + 1, domain: sourceDomain(s) }));
  const hasReasoning = Boolean(String(reasoning || "").trim());
  const searched = results.length > 0 || Boolean(searchQuery);
  const working = live && !answering;

  // What it's doing right now, for the line at the top.
  const now = isThinking
    ? cleanSummary(summarizeReasoning(reasoning)) || "Thinking"
    : searching
      ? "Searching the web"
      : working && results.length
        ? `Reading ${results.length} result${results.length === 1 ? "" : "s"}`
        : working
          ? "Thinking"
          : "";
  useEffect(() => {
    if (working || !startedAt || elapsed !== null) return undefined;
    const timer = setTimeout(() => setElapsed(Date.now() - startedAt), 0);
    return () => clearTimeout(timer);
  }, [working, startedAt, elapsed]);
  const ms = durationMs || elapsed;
  const seconds = ms ? Math.max(1, Math.round(ms / 1000)) : null;
  const doneLabel = [
    hasReasoning || seconds ? (seconds ? `Thought for ${seconds}s` : "Thought it through") : "",
    searched ? "Searched the web" : "",
  ].filter(Boolean).join(" · ") || "Worked on it";
  const label = useSteadyLabel(working ? now : doneLabel);
  // The line is still on a step after the work is done until it catches up.
  const settling = !working && label !== doneLabel;

  useEffect(() => {
    if (!open || !isThinking) return;
    const el = thinkRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoning, open, isThinking]);

  if (!hasReasoning && !isThinking && !searched && !searching) return null;

  const visible = allResults ? results : results.slice(0, SHOWN_RESULTS);
  const active = working || settling;

  return (
    <div className={`vrp${active ? " is-active" : ""}${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="vrp-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <span className="vrp-label" aria-live="polite">{label}</span>
        <ChevronRight size={15} strokeWidth={2} className="vrp-chevron" aria-hidden="true" />
      </button>

      <div className="vrp-body-wrap" id={bodyId}>
        <div className="vrp-body">
          <ol className="vrp-steps">
            {(searched || searching) && (
              <li className={`vrp-step${searching ? " is-now" : ""}`}>
                <span className="vrp-icon" aria-hidden="true"><Globe size={14} /></span>
                <div className="vrp-step-body">
                  <div className="vrp-step-title">
                    <span className="vrp-query">{searchQuery || "Searched the web"}</span>
                    {results.length > 0 && <span className="vrp-count">{results.length} result{results.length === 1 ? "" : "s"}</span>}
                  </div>
                  {results.length > 0 && (
                    <ul className="vrp-results">
                      {visible.map((s) => {
                        const fresh = freshness(s.published);
                        return (
                          <li key={s.n}>
                            <a className="vrp-result" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title || s.url}>
                              <SourceFavicon domain={s.domain} />
                              <span className="vrp-result-title">{s.title && s.title !== "(untitled)" ? s.title : s.url}</span>
                              <span className="vrp-result-site">{s.domain}{fresh ? ` · ${fresh}` : ""}</span>
                            </a>
                          </li>
                        );
                      })}
                      {results.length > SHOWN_RESULTS && (
                        <li>
                          <button type="button" className="vrp-more" onClick={() => setAllResults((v) => !v)}>
                            {allResults ? "Show fewer" : `${results.length - SHOWN_RESULTS} more`}
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </li>
            )}
            {(hasReasoning || isThinking) && (
              <li className={`vrp-step${isThinking ? " is-now" : ""}`}>
                <span className="vrp-icon" aria-hidden="true"><Brain size={14} /></span>
                <div className="vrp-step-body">
                  <div className="vrp-think" ref={thinkRef}>
                    {hasReasoning ? readable(reasoning) : <span className="vrp-placeholder">Working through the request…</span>}
                  </div>
                </div>
              </li>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
});

export default ResponseProcess;
