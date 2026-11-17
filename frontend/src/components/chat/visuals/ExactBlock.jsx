import React, { useContext, useMemo, useState } from "react";
import { ImageDown, Maximize2 } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import DiagramViewer from "../DiagramViewer";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { fileName, saveBlob, savePng } from "../../../lib/exact/download.js";

// A drawing the app works out exactly from the model's description — a ray
// diagram, a circuit, a geometry figure, a graph (lib/exact/). `render`
// turns the block's text into { title, svg, width, height } or { error }.
// White paper in both themes, like the page it would be drawn on.

export function DrawingBody({ result, kind }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button type="button" className="vex-sheet" onClick={() => setExpanded(true)} aria-label={`${result.title || kind}: open full screen`}>
        <span className="vex-sheet-svg" style={{ maxWidth: `${Math.max(320, result.width * 1.15)}px` }} dangerouslySetInnerHTML={{ __html: result.svg }} />
      </button>
      <div className="vor-bar">
        <span className="vor-meta">{result.note || "Worked out exactly by VetroAI"}</span>
        <span className="vor-actions">
          <button type="button" onClick={() => setExpanded(true)}><Maximize2 size={13} /> Expand</button>
          <button type="button" onClick={() => savePng(result.svg, result.width, result.height, result.title || kind)}><ImageDown size={13} /> PNG</button>
        </span>
      </div>
      {expanded && <DiagramViewer svg={result.svg} title={result.title || kind} onClose={() => setExpanded(false)} />}
    </>
  );
}

export default function ExactBlock({ code, fallback, render, icon, kind, what }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const result = useMemo(() => {
    if (pending) return null;
    try { return render(code); } catch (err) { return { error: err?.message || String(err) }; }
  }, [code, pending, render]);
  if (!result) return <VisualPending icon={icon} label={`Working out the ${what}…`} sketch="diagram" />;
  if (result.error) return <VisualFallback what={what} error={result.error} fallback={fallback} />;
  return (
    <VisualCard
      icon={icon}
      title={`${result.title || kind} · ${kind}`}
      code={code}
      onDownload={() => saveBlob(new Blob([result.svg], { type: "image/svg+xml" }), fileName(result.title || kind, "svg"))}
      downloadLabel="Download SVG"
      bodyClassName="vor-body"
    >
      <DrawingBody result={result} kind={kind} />
    </VisualCard>
  );
}
