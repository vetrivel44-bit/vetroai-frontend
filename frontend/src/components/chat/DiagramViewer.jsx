import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize, Minus, Plus, X } from "lucide-react";

// Full-screen viewer for a diagram too wide to read inside the chat on a
// phone: pinch or scroll-wheel to zoom, drag to pan, double-tap to zoom in on
// a spot (or back out to the whole diagram), Esc or ✕ to close. Rendered into
// <body>, since the chat card may be transformed by its entrance animation
// and that would trap a fixed overlay inside it.

const MAX_SCALE = 4;

// Natural size of a Mermaid SVG, from its viewBox.
function naturalSize(svg) {
  const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
  const r = svg.getBoundingClientRect();
  return { w: r.width || 800, h: r.height || 600 };
}

// Zoom by `factor` keeping the point (px, py) of the stage fixed under the finger.
function zoomAround(view, px, py, nextScale) {
  const k = nextScale / view.s;
  return { s: nextScale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

export default function DiagramViewer({ svg, title, onClose }) {
  const stageRef = useRef(null);
  const contentRef = useRef(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const fitRef = useRef(1);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const [hint, setHint] = useState(true);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { w, h } = sizeRef.current;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    const s = Math.min(cw / w, ch / h) * 0.94;
    fitRef.current = s;
    setView({ s, x: (cw - w * s) / 2, y: (ch - h * s) / 2 });
  }, []);

  // Opening view: a diagram that fits readably is shown whole; a wide one
  // (a phone in portrait) opens at up to 100% filling the height, from its
  // left edge, to be dragged through like a panorama.
  const open = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { w, h } = sizeRef.current;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    const whole = Math.min(cw / w, ch / h) * 0.94;
    fitRef.current = whole;
    const s = Math.max(whole, Math.min(1, (ch / h) * 0.94));
    if (s <= whole * 1.05) { fit(); return; }
    setView({ s, x: 16, y: (ch - h * s) / 2 });
  }, [fit]);

  // Put the SVG in and open it.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.innerHTML = svg;
    const el = content.querySelector("svg");
    if (!el) return;
    const size = naturalSize(el);
    sizeRef.current = size;
    el.setAttribute("width", String(size.w));
    el.setAttribute("height", String(size.h));
    el.style.maxWidth = "none";
    el.style.width = `${size.w}px`;
    el.style.height = `${size.h}px`;
    open();
  }, [svg, open]);

  // Esc closes; the page behind doesn't scroll; refit on rotate/resize.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", fit);
    const t = setTimeout(() => setHint(false), 2600);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", fit);
      clearTimeout(t);
    };
  }, [onClose, fit]);

  const clampScale = (s) => Math.max(fitRef.current * 0.8, Math.min(MAX_SCALE, s));
  const zoomBy = (factor, px, py) => {
    const stage = stageRef.current;
    const cx = px ?? stage.clientWidth / 2;
    const cy = py ?? stage.clientHeight / 2;
    setView((v) => zoomAround(v, cx, cy, clampScale(v.s * factor)));
  };

  // ── pointer gestures: one finger pans, two fingers pinch ──
  const pointers = useRef(new Map());
  const lastTap = useRef(0);
  const local = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e) => {
    stageRef.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    setHint(false);
  };
  const onPointerMove = (e) => {
    const map = pointers.current;
    if (!map.has(e.pointerId)) return;
    const prev = [...map.values()];
    const before = map.get(e.pointerId);
    const now = local(e);
    map.set(e.pointerId, now);
    if (map.size === 1) {
      setView((v) => ({ ...v, x: v.x + now.x - before.x, y: v.y + now.y - before.y }));
    } else if (map.size === 2) {
      const [a0, b0] = prev;
      const [a1, b1] = [...map.values()];
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1;
      const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1;
      const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      setView((v) => {
        const z = zoomAround(v, m0.x, m0.y, clampScale(v.s * (d1 / d0)));
        return { ...z, x: z.x + m1.x - m0.x, y: z.y + m1.y - m0.y };
      });
    }
  };
  const onPointerUp = (e) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!p || pointers.current.size) return;
    // Double tap: zoom in on the spot, or back out to the whole diagram.
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      const v = viewRef.current;
      if (v.s > fitRef.current * 1.5) fit();
      else setView(zoomAround(v, p.x, p.y, clampScale(Math.max(1, fitRef.current * 2.5))));
    } else lastTap.current = now;
  };
  const onWheel = (e) => {
    e.preventDefault();
    const p = local(e);
    zoomBy(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };
  useEffect(() => {
    const stage = stageRef.current;
    stage?.addEventListener("wheel", onWheel, { passive: false });
    return () => stage?.removeEventListener("wheel", onWheel);
  });

  const percent = Math.round(view.s * 100);
  return createPortal(
    <div className="vetro-viewer" role="dialog" aria-modal="true" aria-label={`${title} — full screen`}>
      <div className="vetro-viewer-bar">
        <span className="vetro-viewer-title">{title}</span>
        <span className="vetro-viewer-tools">
          <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out"><Minus size={18} /></button>
          <button type="button" className="vetro-viewer-pct" onClick={fit} aria-label="Fit to screen" title="Fit to screen">{percent}%</button>
          <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in"><Plus size={18} /></button>
          <button type="button" onClick={fit} aria-label="Show whole diagram" className="vetro-viewer-fit"><Maximize size={17} /></button>
          <button type="button" onClick={onClose} aria-label="Close" className="vetro-viewer-close"><X size={20} /></button>
        </span>
      </div>
      <div
        ref={stageRef}
        className="vetro-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={contentRef}
          className="vetro-viewer-content"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        />
        <div className={`vetro-viewer-hint${hint ? "" : " is-hidden"}`}>Drag to explore · pinch or double-tap to zoom</div>
      </div>
    </div>,
    document.body,
  );
}
