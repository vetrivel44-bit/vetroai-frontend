import React, { useEffect, useId, useRef, useState } from "react";
import { Brain, Check, ChevronRight, Globe, Users, X } from "lucide-react";
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

// The app's status line for the request ("Reading report.pdf…") as a step:
// no trailing dots. Searching and researching have steps of their own.
const stepLabel = (status) => String(status || "").trim().replace(/(?:\.{3}|…)+$/, "").trim();
const OWN_STEP = /^(?:thinking|searching the web|researching|preparing|streaming|idle|retrying)\b/i;

// "4.2s", how long a council member took.
const took = (ms) => (Number(ms) > 0 ? `${(Number(ms) / 1000).toFixed(Number(ms) < 10000 ? 1 : 0)}s` : "");

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
 * above the reply saying what it's doing now ("Thinking", "Reading
 * report.pdf", "Searching the web", "Reading 10 results"), each step up long
 * enough to read, ending as "Thought for 4s · Searched the web". Tapping it
 * opens the steps: what it did, the search (the query and the results it
 * found) and the thinking.
 *
 * It shows from the moment a message is sent (`status` is the app's line
 * for the request), so the wait looks the same as the work. With nothing to
 * show afterwards (no thinking, no search), it goes once the answer starts,
 * as Claude's does.
 *
 * `council`: for a hard question the server first asks a few other AI
 * models (backend councilService.js), and `writer` (the model that answered)
 * weighs their answers before it writes. The line only says "Thinking
 * deeply"; who was asked and what each said is shown in the steps, when the
 * person opens them.
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
  status = "",
  council = null,
  writer = "",
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
  const members = Array.isArray(council?.members) ? council.members : [];
  const hasCouncil = members.length > 0;
  const councilSitting = hasCouncil && council.phase !== "done";
  const answeredCount = members.filter((m) => m.status === "answered").length;

  // The steps it has been through, from the app's status line: each new one
  // is added as it comes (state adjusted while rendering, React's pattern
  // for state that follows a prop).
  const [history, setHistory] = useState([]);
  const current = working ? stepLabel(status) : "";
  if (current && !OWN_STEP.test(current) && !history.includes(current)) setHistory([...history, current]);

  // What it's doing right now, for the line at the top.
  const now = isThinking
    ? cleanSummary(summarizeReasoning(reasoning)) || "Thinking"
    : searching
      ? "Searching the web"
      : working && councilSitting
        ? "Thinking deeply"
      : working && results.length
        ? `Reading ${results.length} result${results.length === 1 ? "" : "s"}`
        : working
          ? current || "Thinking"
          : "";
  useEffect(() => {
    if (working || !startedAt || elapsed !== null) return undefined;
    const timer = setTimeout(() => setElapsed(Date.now() - startedAt), 0);
    return () => clearTimeout(timer);
  }, [working, startedAt, elapsed]);
  const ms = durationMs || elapsed || council?.ms;
  const seconds = ms ? Math.max(1, Math.round(ms / 1000)) : null;
  const doneLabel = [
    hasReasoning || hasCouncil || seconds ? (seconds ? `Thought for ${seconds}s` : "Thought it through") : "",
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

  if (!hasReasoning && !isThinking && !searched && !searching && !working && !hasCouncil) return null;
  // Working, and nothing yet but the wait: the steps say so.
  const waitingOnly = working && !hasReasoning && !isThinking && !searched && !searching && !hasCouncil;

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
            {history.map((step, n) => {
              const onIt = working && n === history.length - 1 && step === current && !searching && !isThinking;
              return (
                <li key={step} className={`vrp-step${onIt ? " is-now" : ""}`}>
                  <span className="vrp-icon" aria-hidden="true">{onIt ? <span className="vrp-pulse" /> : <Check size={13} strokeWidth={2.4} />}</span>
                  <div className="vrp-step-body"><div className="vrp-step-title"><span className="vrp-query">{step}</span></div></div>
                </li>
              );
            })}
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
            {hasCouncil && (
              <li className={`vrp-step${councilSitting ? " is-now" : ""}`}>
                <span className="vrp-icon" aria-hidden="true"><Users size={14} /></span>
                <div className="vrp-step-body">
                  <div className="vrp-step-title">
                    {/* A model that couldn't answer is replaced by the next in line (backend councilService.js). */}
                    <span className="vrp-query">{councilSitting ? "Asking" : "Asked"} {members.length} other AI model{members.length === 1 ? "" : "s"}</span>
                    <span className="vrp-count">{answeredCount} of {members.length} answered</span>
                  </div>
                  <ul className="vrp-council">
                    {members.map((member, n) => (
                      <li key={`${member.name}-${n}`}>
                        {member.status === "answered" ? (
                          <details className="vrp-member">
                            <summary>
                              <span className="vrp-member-mark is-done" aria-hidden="true"><Check size={12} strokeWidth={2.6} /></span>
                              <span className="vrp-member-name">{member.name}{member.standsInFor && <span className="vrp-member-sub"> · stood in for {member.standsInFor}</span>}</span>
                              <span className="vrp-member-time">{took(member.ms)}</span>
                              <ChevronRight size={13} className="vrp-member-chevron" aria-hidden="true" />
                            </summary>
                            <div className="vrp-member-answer">{member.answer}</div>
                          </details>
                        ) : (
                          <div className="vrp-member is-flat">
                            <span className={`vrp-member-mark${member.status === "failed" ? " is-failed" : ""}`} aria-hidden="true">
                              {member.status === "failed" ? <X size={12} strokeWidth={2.6} /> : <span className="vrp-pulse" />}
                            </span>
                            <span className="vrp-member-name">{member.name}{member.standsInFor && <span className="vrp-member-sub"> · for {member.standsInFor}</span>}</span>
                            <span className="vrp-member-time">{member.status === "failed" ? "couldn't answer" : "thinking…"}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!councilSitting && answeredCount > 0 && (
                    <p className="vrp-council-note">
                      {writer ? `${writer} weighed their answers and wrote the reply.` : "Their answers were weighed before the reply was written."}
                    </p>
                  )}
                </div>
              </li>
            )}
            {(hasReasoning || isThinking || (waitingOnly && !history.length)) && (
              <li className={`vrp-step${isThinking || waitingOnly ? " is-now" : ""}`}>
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

/**
 * Under a reply while it's being written (where Claude shows its spark): a
 * little stick figure dancing, so the wait is something to smile at. Same
 * size as the mark it replaced; the moves are in ResponseProcess.css.
 */
export function VetroWorking() {
  return (
    <div className="vetro-working" role="status" aria-label="VetroAI is working">
      <svg className="vw-dancer" viewBox="0 0 24 28" width="24" height="26" focusable="false" aria-hidden="true">
        <ellipse className="vw-shadow" cx="12" cy="26.6" rx="5" ry="0.9" />
        <g className="vw-body">
          <path className="vw-leg vw-leg-l" d="M12 16.2 L9.6 20.6 L8.6 25" />
          <path className="vw-leg vw-leg-r" d="M12 16.2 L14.4 20.6 L15.4 25" />
          <path className="vw-limb" d="M12 8.4 L12 16.2" />
          {/* Each arm swings at the shoulder and its forearm at the elbow,
              so a raised arm straightens into a point. */}
          <g className="vw-arm vw-arm-l">
            <path d="M12 10.2 L8.6 12.6" />
            <path className="vw-fore vw-fore-l" d="M8.6 12.6 L6.2 10.4" />
          </g>
          <g className="vw-arm vw-arm-r">
            <path d="M12 10.2 L15.4 12.6" />
            <path className="vw-fore vw-fore-r" d="M15.4 12.6 L17.8 10.4" />
          </g>
          <circle className="vw-head" cx="12" cy="4.9" r="2.9" />
        </g>
      </svg>
    </div>
  );
}

export default ResponseProcess;
