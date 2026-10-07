import React, { useEffect, useId, useState } from "react";
import { BookOpen, ChevronDown, CircleAlert, CircleCheck, Compass, PenLine, ScanSearch, Search, ShieldCheck, Telescope, X, Check } from "lucide-react";
import { RESEARCH_STAGES, isResearching, researchMeta, researchTitle, stageProgress, stepKind } from "../lib/research";
import SourceFavicon from "./SourceFavicon";
import "./ResearchActivity.css";

const STEP_ICONS = { plan: Compass, search: Search, read: BookOpen, reflect: ScanSearch, verify: ShieldCheck, write: PenLine };

/** Overlapping site icons, like the avatars on a shared doc. */
function SiteStack({ domains, total }) {
  const shown = domains.slice(0, 5);
  if (!shown.length) return null;
  const more = Math.max(0, Math.max(total || 0, domains.length) - shown.length);
  return (
    <span className="vai-ra-stack" aria-hidden="true">
      {shown.map((d) => <SourceFavicon key={d} domain={d} />)}
      {more > 0 && <span className="vai-ra-stack-more">+{more}</span>}
    </span>
  );
}

/** The five stages as a segmented bar, the current one shimmering. */
function StageBar({ research, live }) {
  const { reached, current } = stageProgress(research, live);
  return (
    <div className="vai-ra-stages" aria-hidden="true">
      {RESEARCH_STAGES.map((stage, i) => {
        const state = i === current ? "current" : i <= reached ? "reached" : "todo";
        return (
          <span key={stage} className={`vai-ra-stage is-${state}`}>
            <span className="vai-ra-stage-bar" />
            <span className="vai-ra-stage-label">{stage}</span>
          </span>
        );
      })}
    </div>
  );
}

function StepChips({ kind, items }) {
  if (!items?.length) return null;
  return (
    <span className="vai-ra-chips">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className={`vai-ra-chip kind-${kind}`} title={item}>
          {kind === "read" ? <SourceFavicon domain={item} />
            : kind === "verify" ? <ShieldCheck size={11} strokeWidth={2.2} />
            : <Search size={11} strokeWidth={2.2} />}
          <span className="vai-ra-chip-text">{item}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * DeepSearch's activity, in the style of Claude's Research: a card with the
 * research's stage, the sites it has found and a running clock, opening onto
 * the research plan, every step (with its queries and the pages it read) and
 * the sites consulted. Open while the research runs, folded into a one-line
 * summary once the report starts.
 */
const ResearchActivity = React.memo(function ResearchActivity({ research, live = false, answering = false }) {
  const active = isResearching(research, live);
  // null = follow the automatic open/close; true/false = the user's choice.
  const [userOpen, setUserOpen] = useState(null);
  // The server's elapsed time when this panel appeared, ticked on locally.
  const [startedAt] = useState(() => Date.now() - (Number(research?.elapsedMs) || 0));
  const [now, setNow] = useState(() => Date.now());
  const bodyId = useId();

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!research?.steps?.length) return null;

  const open = userOpen === null ? active && !answering : userOpen;
  const state = active ? "active" : research.phase === "done" ? "done" : "stopped";
  const Glyph = state === "active" ? Telescope : state === "done" ? CircleCheck : CircleAlert;
  const angles = research.angles || [];
  const domains = research.domains || [];
  const counts = research.angleSources || [];
  const moreSites = Math.max(0, (Number(research.sites) || 0) - domains.length);

  return (
    <section className={`vai-ra is-${state}${open ? " is-open" : ""}`} aria-label="DeepSearch research">
      <button type="button" className="vai-ra-header" onClick={() => setUserOpen(!open)} aria-expanded={open} aria-controls={bodyId}>
        <span className="vai-ra-glyph" aria-hidden="true">
          <Glyph size={18} strokeWidth={2} />
          {state === "active" && <span className="vai-ra-orbit"><span /></span>}
        </span>
        <span className="vai-ra-heading">
          <span className="vai-ra-title">{researchTitle(research, live)}</span>
          <span className="vai-ra-meta">{researchMeta(research, { live, elapsedMs: active ? now - startedAt : undefined })}</span>
        </span>
        <SiteStack domains={domains} total={research.sites} />
        <ChevronDown size={16} strokeWidth={2} className="vai-ra-chevron" aria-hidden="true" />
      </button>

      {(active || open) && <StageBar research={research} live={live} />}

      <div className="vai-ra-body" id={bodyId} hidden={!open}>
        {angles.length > 1 && (
          <div className="vai-ra-section">
            <h4 className="vai-ra-section-title">Research plan</h4>
            <ol className="vai-ra-plan">
              {angles.map((angle, i) => (
                <li key={i}>
                  <span className="vai-ra-num">{i + 1}</span>
                  <span className="vai-ra-angle">{angle}</span>
                  {counts[i] > 0 && <span className="vai-ra-count">{counts[i]} {counts[i] === 1 ? "source" : "sources"}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="vai-ra-section">
          <h4 className="vai-ra-section-title">Activity</h4>
          <ol className="vai-ra-steps" aria-live="polite">
            {research.steps.map((step, i) => {
              const kind = stepKind(step.id);
              const Icon = STEP_ICONS[kind] || Search;
              return (
                <li key={`${step.id}-${i}`} className={`vai-ra-step is-${step.status}`}>
                  <span className="vai-ra-icon" aria-hidden="true">
                    {step.status === "failed" ? <X size={13} strokeWidth={2.4} /> : step.status === "done" && kind !== "write" ? <Check size={13} strokeWidth={2.6} /> : <Icon size={13} strokeWidth={2.2} />}
                  </span>
                  <span className="vai-ra-step-body">
                    <span className="vai-ra-step-label">{step.label}</span>
                    {step.detail && <span className="vai-ra-step-detail">{step.detail}</span>}
                    <StepChips kind={kind} items={step.items} />
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {domains.length > 0 && (
          <div className="vai-ra-section">
            <h4 className="vai-ra-section-title">Sites consulted</h4>
            <div className="vai-ra-sites">
              {domains.map((d) => (
                <span key={d} className="vai-ra-site"><SourceFavicon domain={d} /><span>{d}</span></span>
              ))}
              {moreSites > 0 && <span className="vai-ra-site is-more">+{moreSites} more</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
});

export default ResearchActivity;
