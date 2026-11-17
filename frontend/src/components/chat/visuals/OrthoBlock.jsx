import React, { useContext, useEffect, useState } from "react";
import { DraftingCompass, ImageDown, Maximize2 } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import DiagramViewer from "../DiagramViewer";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { renderOrtho } from "../../../lib/ortho/index.js";

// An ```ortho block: an engineering drawing (orthographic projection) worked
// out exactly from the solid the model described — every view, hidden line,
// centre line and dimension computed, never drawn by guesswork. The sheet is
// white paper in both themes, like a drawing sheet, and downloads as SVG
// (true to scale when printed) or PNG.

const CACHE = new Map(); // code → result, so reopening a chat doesn't redo the maths
const remember = (code, result) => {
  CACHE.set(code, result);
  if (CACHE.size > 24) CACHE.delete(CACHE.keys().next().value);
};

// One worker for every drawing; if workers aren't available, the maths runs
// here, just after the pending card has shown.
let worker = null;
let nextId = 0;
const waiting = new Map();
function drawOrtho(code) {
  if (!worker && typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("../../../lib/ortho/worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event) => {
        const { id, result } = event.data || {};
        waiting.get(id)?.(result);
        waiting.delete(id);
      };
      worker.onerror = () => {
        // A worker that can't start: everything waiting is done here instead.
        worker = false;
        for (const [id, done] of waiting) { waiting.delete(id); done(null); }
      };
    } catch { worker = false; }
  }
  if (!worker) return new Promise((resolve) => setTimeout(() => resolve(renderOrtho(code)), 30));
  return new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, (result) => resolve(result || renderOrtho(code)));
    worker.postMessage({ id, code });
  });
}

const fileName = (title, ext) => `${String(title || "drawing").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "drawing"}.${ext}`;

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// The sheet as a PNG at 5 pixels per millimetre (an A3 sheet: 2100 × 1485).
function savePng(result) {
  const px = 5;
  const w = Math.round(result.width * px);
  const h = Math.round(result.height * px);
  const svg = result.svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => blob && save(blob, fileName(result.title, "png")), "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// The full-screen viewer sizes a drawing by its viewBox, one pixel a unit:
// a sheet in millimetres would open tiny, so it gets one at 3 units a mm.
function forViewer(result, factor = 3) {
  const inner = result.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${result.width * factor} ${result.height * factor}"><g transform="scale(${factor})" font-family="Arial, Helvetica, sans-serif">${inner}</g></svg>`;
}

export default function OrthoBlock({ code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const [done, setDone] = useState(null); // { code, result }
  const [expanded, setExpanded] = useState(false);

  // Worked out once the block is complete, in the background, so the reply
  // keeps scrolling while the maths runs.
  useEffect(() => {
    if (pending || CACHE.has(code)) return undefined;
    let live = true;
    drawOrtho(code).then((result) => {
      remember(code, result);
      if (live) setDone({ code, result });
    });
    return () => { live = false; };
  }, [code, pending]);

  const result = pending ? null : CACHE.get(code) || (done?.code === code ? done.result : null);
  if (!result) return <VisualPending icon={DraftingCompass} label="Working out the views…" sketch="diagram" />;
  if (result.error) return <VisualFallback what="drawing" error={result.error} fallback={fallback} />;

  const angle = result.projection === "third" ? "Third-angle" : "First-angle";
  return (
    <VisualCard
      icon={DraftingCompass}
      title={`${result.title} · engineering drawing`}
      code={code}
      onDownload={() => save(new Blob([result.svg], { type: "image/svg+xml" }), fileName(result.title, "svg"))}
      downloadLabel="Download SVG"
      bodyClassName="vor-body"
    >
      <button type="button" className="vor-sheet" onClick={() => setExpanded(true)} aria-label={`${result.title}: open the drawing full screen`}>
        <span className="vor-sheet-svg" dangerouslySetInnerHTML={{ __html: result.svg }} />
      </button>
      <div className="vor-bar">
        <span className="vor-meta">{angle} projection · Scale {result.scale}{result.sheet ? ` · ${result.sheet} sheet` : ""} · mm</span>
        <span className="vor-actions">
          <button type="button" onClick={() => setExpanded(true)}><Maximize2 size={13} /> Expand</button>
          <button type="button" onClick={() => savePng(result)}><ImageDown size={13} /> PNG</button>
        </span>
      </div>
      {result.iso && (
        <figure className="vor-check">
          <span className="vor-check-svg" dangerouslySetInnerHTML={{ __html: result.iso }} />
          <figcaption>
            <strong>The object as read</strong>
            Every line above is worked out from this 3D shape. If it isn’t the object in the question, say what’s different and it will be redrawn.
          </figcaption>
        </figure>
      )}
      {result.notes?.map((n) => <p key={n} className="vor-note">{n}</p>)}
      {expanded && <DiagramViewer svg={forViewer(result)} title={result.title} onClose={() => setExpanded(false)} />}
    </VisualCard>
  );
}
