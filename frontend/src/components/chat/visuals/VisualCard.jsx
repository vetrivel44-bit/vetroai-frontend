import React, { useState } from "react";
import { Check, Code2, Copy, Download } from "lucide-react";
import "../mermaidDiagram.css";
import "./visuals.css";
import { useBornLive } from "../../../lib/streamReveal";

// The frame every inline visual shares with the Mermaid diagrams: a title
// bar (type + name), a Code toggle, Copy, an optional download, and the body.
export default function VisualCard({ icon: Icon, title, code, onDownload, downloadLabel = "Download", children, bodyClassName = "" }) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  // Animates in when it arrives during a reply, not when history reopens.
  const bornLive = useBornLive();
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <div className={`vetro-diagram vetro-visual not-prose${bornLive ? " vetro-born-live" : ""}`}>
      <div className="vetro-diagram-head">
        <span className="vetro-diagram-title">{Icon && <Icon size={14} />} {title}</span>
        <span className="vetro-diagram-actions">
          <button type="button" onClick={() => setShowCode((v) => !v)} title={showCode ? "Show visual" : "Show code"} aria-label={showCode ? "Show visual" : "Show code"}>
            {showCode ? <>{Icon && <Icon size={14} />}<span className="vetro-diagram-btn-label">View</span></> : <><Code2 size={14} /><span className="vetro-diagram-btn-label">Code</span></>}
          </button>
          <button type="button" onClick={copy} title="Copy code" aria-label="Copy code">
            {copied ? <><Check size={14} /><span className="vetro-diagram-btn-label">Copied</span></> : <><Copy size={14} /><span className="vetro-diagram-btn-label">Copy</span></>}
          </button>
          {onDownload && (
            <button type="button" onClick={onDownload} title={downloadLabel} aria-label={downloadLabel}>
              <Download size={14} /><span className="vetro-diagram-btn-label">{downloadLabel.replace(/^Download (as )?/, "")}</span>
            </button>
          )}
        </span>
      </div>
      {/* The visual stays mounted while the code is shown, so a chart or map
          doesn't have to be rebuilt when toggling back. */}
      <pre className="vetro-diagram-code" hidden={!showCode}><code>{code}</code></pre>
      <div className={`vetro-visual-body ${bodyClassName}`} hidden={showCode}>{children}</div>
    </div>
  );
}

// A faint sketch of what is being made, drawn piece by piece in a loop while
// the block streams in: boxes and arrows for a diagram, rising bars for a
// chart, a pin dropping on a grid for a map, lines for anything else.
export function PendingSketch({ kind = "lines" }) {
  if (kind === "diagram") {
    return (
      <svg className="vetro-sketch" viewBox="0 0 240 92" aria-hidden="true">
        <rect className="sk sk-1" x="8" y="31" width="58" height="30" rx="8" />
        <path className="sk-line sk-2" d="M66 46 H90" />
        <rect className="sk sk-3" x="91" y="31" width="58" height="30" rx="8" />
        <path className="sk-line sk-4" d="M149 46 C162 46 162 20 175 20" />
        <path className="sk-line sk-4" d="M149 46 C162 46 162 72 175 72" />
        <rect className="sk sk-5" x="175" y="6" width="58" height="28" rx="8" />
        <rect className="sk sk-6" x="175" y="58" width="58" height="28" rx="8" />
      </svg>
    );
  }
  if (kind === "chart") {
    return (
      <svg className="vetro-sketch" viewBox="0 0 240 92" aria-hidden="true">
        <path className="sk-line sk-axis" d="M14 84 H228 M14 84 V8" />
        {[38, 60, 30, 72, 50, 64].map((h, i) => (
          <rect key={i} className={`sk sk-bar sk-${i + 1}`} x={26 + i * 34} y={84 - h} width="20" height={h} rx="4" />
        ))}
      </svg>
    );
  }
  if (kind === "map") {
    return (
      <svg className="vetro-sketch" viewBox="0 0 240 92" aria-hidden="true">
        <path className="sk-line sk-grid" d="M0 30 H240 M0 62 H240 M60 0 V92 M130 0 V92 M196 0 V92" />
        <path className="sk-line sk-road sk-2" d="M0 76 C60 70 90 20 160 26 S220 50 240 40" />
        <g className="sk-pin"><path className="sk" d="M120 18 c-9 0 -15 7 -15 15 c0 11 15 25 15 25 s15 -14 15 -25 c0 -8 -6 -15 -15 -15z" /><circle cx="120" cy="33" r="5" className="sk-hole" /></g>
      </svg>
    );
  }
  return (
    <svg className="vetro-sketch" viewBox="0 0 240 92" aria-hidden="true">
      {[220, 180, 205, 140].map((w, i) => <rect key={i} className={`sk sk-${i + 1}`} x="10" y={10 + i * 20} width={w} height="10" rx="5" />)}
    </svg>
  );
}

// Placeholder while the block is still streaming in.
export function VisualPending({ icon: Icon, label, sketch = "lines" }) {
  return (
    <div className="vetro-diagram vetro-pending not-prose vetro-born-live">
      <div className="vetro-diagram-pending">
        <PendingSketch kind={sketch} />
        <span className="vetro-pending-label">{Icon && <Icon size={15} />} {label.replace(/…$/, "")}<span className="vetro-dots" aria-hidden="true" /></span>
      </div>
    </div>
  );
}

// Parse/render failure: a one-line note, then the block as ordinary code.
export function VisualFallback({ what, error, fallback }) {
  return (
    <div className="vetro-diagram-fallback not-prose">
      <div className="vetro-diagram-error">Couldn’t show this {what}{error ? ` (${error})` : ""}. Showing the code instead.</div>
      {fallback}
    </div>
  );
}
