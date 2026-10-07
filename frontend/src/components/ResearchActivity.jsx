import React, { useEffect, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { isResearching, researchHeadline, researchStats } from "../lib/research";
import "./ResearchActivity.css";

/**
 * DeepSearch's activity, in the style of Claude's Research: the plan (the
 * angles being researched) and each step as it happens — searching, reading
 * pages, looking for gaps, cross-checking claims, writing. Open while the
 * research runs, then folded into a "Researched N sources in 1m 12s" line
 * once the report starts.
 */
const ResearchActivity = React.memo(function ResearchActivity({ research, live = false, answering = false }) {
  const active = isResearching(research, live);
  // null = follow the automatic open/close; true/false = the user's choice.
  const [userOpen, setUserOpen] = useState(null);
  // The server's elapsed time when this panel appeared, ticked on locally.
  const [startedAt] = useState(() => Date.now() - (Number(research?.elapsedMs) || 0));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!research?.steps?.length) return null;

  const open = userOpen === null ? active && !answering : userOpen;
  const headline = researchHeadline(research, { live, elapsedMs: active ? now - startedAt : undefined });
  const stats = researchStats(research);
  const angles = research.angles || [];

  return (
    <div className={`vai-ra${active ? " is-active" : ""}${open ? " is-open" : ""}`}>
      <button type="button" className="vai-ra-header" onClick={() => setUserOpen(!open)} aria-expanded={open}>
        <span className="vai-ra-label">{headline}</span>
        {stats && <span className="vai-ra-stats">{stats}</span>}
        <ChevronRight size={15} strokeWidth={2} className="vai-ra-chevron" aria-hidden="true" />
      </button>

      <div className="vai-ra-body" hidden={!open}>
        {angles.length > 1 && (
          <div className="vai-ra-plan">
            <p className="vai-ra-heading">Research plan</p>
            <ol>
              {angles.map((angle, i) => <li key={i}>{angle}</li>)}
            </ol>
          </div>
        )}
        <ol className="vai-ra-steps" aria-live="polite">
          {research.steps.map((step, i) => (
            <li key={`${step.id}-${i}`} className={`vai-ra-step is-${step.status}`}>
              <span className="vai-ra-icon" aria-hidden="true">
                {step.status === "done" ? <Check size={12} strokeWidth={3} />
                  : step.status === "failed" ? <X size={12} strokeWidth={3} />
                  : <span className="vai-ra-spinner" />}
              </span>
              <span className="vai-ra-step-text">
                <span className="vai-ra-step-label">{step.label}</span>
                {step.detail && <span className="vai-ra-step-detail">{step.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});

export default ResearchActivity;
