import React, { useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import { Maximize2, PenLine } from "lucide-react";
import rough from "roughjs";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import VisualCard from "./VisualCard";
import DiagramViewer from "../DiagramViewer";
import { useDocumentTheme } from "./useDocumentTheme";
import { useBornLive } from "../../../lib/streamReveal";
import { isInkColor, parseSketch } from "../../../lib/sketchSvg";
import { createPen, penSession as getPenSession, planSketch } from "../diagramPen";

// A ```sketch block: a hand-drawn picture of whatever was asked for — a house,
// the heart, a plant cell. Each shape the model wrote is redrawn in pencil
// (rough.js) and, while the reply comes in, a pen draws them one by one.

const NS = "http://www.w3.org/2000/svg";
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// The direction a line ends (or starts) in, measured on a hidden path so it
// works for curves too: where to put an arrowhead.
let ruler = null;
function endOf(item, atStart) {
  const a = item.attrs;
  let d = a.d;
  if (item.tag === "line") d = `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
  else if (item.tag === "polyline") d = `M${a.points.map((p) => p.join(" ")).join("L")}`;
  if (!d) return null;
  try {
    if (!ruler) {
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
      svg.setAttribute("aria-hidden", "true");
      ruler = document.createElementNS(NS, "path");
      svg.appendChild(ruler);
      document.body.appendChild(svg);
    }
    ruler.setAttribute("d", d);
    const len = ruler.getTotalLength();
    if (!len) return null;
    const step = Math.min(3, len / 2);
    const tip = ruler.getPointAtLength(atStart ? 0 : len);
    const back = ruler.getPointAtLength(atStart ? step : len - step);
    return { x: tip.x, y: tip.y, angle: Math.atan2(tip.y - back.y, tip.x - back.x) };
  } catch { return null; }
}

function smallArea({ tag, attrs: a }) {
  if (tag === "rect") return a.width * a.height < 500;
  if (tag === "circle") return a.r < 12;
  if (tag === "ellipse") return a.rx * a.ry < 160;
  return false;
}

function arrowHead(rc, end, options) {
  const size = clamp(7 + (options.strokeWidth || 1.7) * 2, 8, 16);
  const wing = (turn) => [end.x - size * Math.cos(end.angle + turn), end.y - size * Math.sin(end.angle + turn)];
  return rc.linearPath([wing(0.45), [end.x, end.y], wing(-0.45)], { ...options, fill: undefined, roughness: 0.6 });
}

function buildSvg({ viewBox, title, items }, theme) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", viewBox.join(" "));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title || "Hand-drawn picture");
  svg.setAttribute("class", "vsk-svg");
  const rc = rough.svg(svg);
  const ink = theme === "dark" ? "#ECE6DC" : "#2B2622";
  const colour = (c, fallback) => (c === "none" ? "none" : isInkColor(c) ? fallback : c);
  items.forEach((item, i) => {
    const a = item.attrs;
    let node;
    if (item.tag === "text") {
      node = document.createElementNS(NS, "text");
      node.setAttribute("x", a.x || 0);
      node.setAttribute("y", a.y || 0);
      node.setAttribute("font-size", clamp(a["font-size"] || 15, 8, 48));
      node.setAttribute("font-family", "Kalam, 'Comic Sans MS', cursive");
      node.setAttribute("fill", a.fill && a.fill !== "none" ? colour(a.fill, ink) : ink);
      if (a["text-anchor"]) node.setAttribute("text-anchor", a["text-anchor"]);
      if (a["font-weight"]) node.setAttribute("font-weight", a["font-weight"]);
      node.textContent = item.text;
    } else {
      const fill = a.fill && a.fill !== "none" ? colour(a.fill, ink) : undefined;
      const o = {
        seed: i + 3, roughness: 1.15, bowing: 0.9,
        stroke: colour(a.stroke, ink), strokeWidth: clamp(a["stroke-width"] ?? 1.7, 0.5, 6),
        fill, fillStyle: "hachure", hachureGap: 4.5, fillWeight: 1.2, hachureAngle: -41,
      };
      // Small parts are coloured in; hatching only reads on bigger areas.
      if (fill && smallArea(item)) o.fillStyle = "solid";
      if (a["stroke-dasharray"]) o.strokeLineDash = a["stroke-dasharray"].split(/[\s,]+/).map(Number).filter(Number.isFinite);
      try {
        if (item.tag === "rect") node = rc.rectangle(a.x || 0, a.y || 0, a.width, a.height, o);
        else if (item.tag === "circle") node = rc.circle(a.cx || 0, a.cy || 0, a.r * 2, o);
        else if (item.tag === "ellipse") node = rc.ellipse(a.cx || 0, a.cy || 0, a.rx * 2, a.ry * 2, o);
        else if (item.tag === "line") node = rc.line(a.x1, a.y1, a.x2, a.y2, o);
        else if (item.tag === "polyline") node = rc.linearPath(a.points, o);
        else if (item.tag === "polygon") node = rc.polygon(a.points, o);
        else if (item.tag === "path") node = rc.path(a.d, o);
      } catch { node = null; /* a malformed path: skip it */ }
    }
    if (!node) return;
    const g = document.createElementNS(NS, "g");
    g.setAttribute("data-pen", String(i));
    // Moved, turned or faded as written: the pen still draws it in place.
    const body = a.transform || a.opacity != null ? document.createElementNS(NS, "g") : g;
    if (body !== g) {
      if (a.transform) body.setAttribute("transform", a.transform);
      if (a.opacity != null) body.setAttribute("opacity", clamp(a.opacity, 0.05, 1));
      g.appendChild(body);
    }
    body.appendChild(node);
    if (item.tag !== "text") {
      const stroke = { stroke: colour(a.stroke, ink), strokeWidth: clamp(a["stroke-width"] ?? 1.7, 0.5, 6), seed: i + 3 };
      for (const [attr, atStart] of [["marker-end", false], ["marker-start", true]]) {
        const end = a[attr] && endOf(item, atStart);
        if (end) body.appendChild(arrowHead(rc, end, stroke));
      }
    }
    svg.appendChild(g);
  });
  return svg;
}

export default function SketchBlock({ code, fallback }) {
  const theme = useDocumentTheme();
  const sketch = useMemo(() => parseSketch(code), [code]);
  const bornLive = useBornLive();
  // Known once the first shape is written, so the live and finished copies agree.
  const sessionKey = sketch.items.length ? `sketch:${JSON.stringify(sketch.items[0])}` : "";
  const session = useMemo(() => getPenSession(sessionKey, bornLive), [sessionKey, bornLive]);
  const stageRef = useRef(null);
  const hostRef = useRef(null);
  const penRef = useRef(null);
  const [svgText, setSvgText] = useState("");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => () => { penRef.current?.destroy(); penRef.current = null; }, []);

  // Rebuilt when a new shape arrives; the same shape always wobbles the same
  // way (its seed is its place), so what was drawn doesn't move.
  const count = sketch.items.length;
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !count) return;
    const svg = buildSvg(sketch, theme);
    host.replaceChildren(svg);
    if (session) {
      const stage = stageRef.current;
      if (stage && penRef.current?.stage !== stage) {
        penRef.current?.destroy();
        penRef.current = createPen(stage, session, planSketch);
      }
      penRef.current?.update(host);
    }
    setSvgText(svg.outerHTML);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, theme, session]);

  if (!count && !bornLive) return fallback;
  const title = sketch.title || "Drawing";
  const download = () => {
    if (!svgText) return;
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "drawing"}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <VisualCard icon={PenLine} title={`${title} · hand-drawn`} code={code} onDownload={svgText ? download : null} downloadLabel="Download SVG" bodyClassName="vsk-body">
      <div className="vetro-diagram-stage vsk-stage" ref={stageRef}>
        {count ? <div ref={hostRef} className="vsk-host" /> : <p className="vsk-wait"><PenLine size={15} /> Picking up the pencil…</p>}
        {svgText && (
          <button type="button" className="vetro-diagram-zoom-pill" onClick={() => setExpanded(true)}>
            <Maximize2 size={13} /> Expand
          </button>
        )}
      </div>
      {expanded && svgText && <DiagramViewer svg={svgText} title={title} onClose={() => setExpanded(false)} />}
    </VisualCard>
  );
}
