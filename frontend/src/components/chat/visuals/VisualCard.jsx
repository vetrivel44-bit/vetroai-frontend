import React, { useState } from "react";
import { Check, Code2, Copy, Download } from "lucide-react";
import "../mermaidDiagram.css";
import "./visuals.css";

// The frame every inline visual shares with the Mermaid diagrams: a title
// bar (type + name), a Code toggle, Copy, an optional download, and the body.
export default function VisualCard({ icon: Icon, title, code, onDownload, downloadLabel = "Download", children, bodyClassName = "" }) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="vetro-diagram vetro-visual not-prose">
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

// Placeholder while the block is still streaming in.
export function VisualPending({ icon: Icon, label }) {
  return (
    <div className="vetro-diagram not-prose">
      <div className="vetro-diagram-pending">{Icon && <Icon size={16} />} {label}</div>
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
