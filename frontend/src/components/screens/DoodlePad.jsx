import React, { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, ImageUp, Redo2, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { DEFAULT_STYLE, DOODLE_STYLES, PEN_COLOURS, PEN_SIZES, hasDrawing, smoothSegments } from "../../lib/doodle";
import "./DoodlePad.css";

const SIZE = 1024; // the page, in its own units: square, whatever the screen
const PAPER = "#ffffff";

// The page and the photo on it (if any), at the page's own size. The ink is
// on its own layer above, so the eraser rubs out only the ink.
function drawPage(ctx, background) {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (background) {
    const scale = Math.min(SIZE / background.width, SIZE / background.height);
    const w = background.width * scale;
    const h = background.height * scale;
    ctx.drawImage(background, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  }
  ctx.restore();
}

function drawStroke(ctx, stroke) {
  const points = stroke.points || [];
  if (!points.length) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.colour;
  ctx.fillStyle = stroke.colour;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0][0], points[0][1], stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const { control, to } of smoothSegments(points)) ctx.quadraticCurveTo(control[0], control[1], to[0], to[1]);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Doodle → picture (lib/doodle.js): draw something rough — or start from a
 * photo of a sketch on paper — say what it is if you like, pick a look, and
 * `onSubmit({ image, description, style })` hands the page (a PNG data URL)
 * to the image model.
 */
export default function DoodlePad({ onSubmit, onClose }) {
  const pageRef = useRef(null); // paper + photo
  const inkRef = useRef(null); // strokes (the eraser clears only these)
  const fileRef = useRef(null);
  const drawingRef = useRef(null);
  const [strokes, setStrokes] = useState([]);
  const [undone, setUndone] = useState([]);
  const [background, setBackground] = useState(null);
  const [colour, setColour] = useState(PEN_COLOURS[0]);
  const [size, setSize] = useState("M");
  const [erasing, setErasing] = useState(false);
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [notice, setNotice] = useState("");

  // Redraw everything whenever the strokes or the photo change.
  useEffect(() => {
    const page = pageRef.current?.getContext("2d");
    const ink = inkRef.current?.getContext("2d");
    if (!page || !ink) return;
    drawPage(page, background);
    ink.clearRect(0, 0, SIZE, SIZE);
    for (const stroke of strokes) drawStroke(ink, stroke);
  }, [strokes, background]);

  const pointOf = (event) => {
    const rect = inkRef.current.getBoundingClientRect();
    return [
      Math.round(((event.clientX - rect.left) / rect.width) * SIZE * 10) / 10,
      Math.round(((event.clientY - rect.top) / rect.height) * SIZE * 10) / 10,
    ];
  };

  const begin = (event) => {
    if (event.button > 0) return;
    event.preventDefault();
    inkRef.current.setPointerCapture?.(event.pointerId);
    const stroke = {
      colour,
      size: erasing ? PEN_SIZES[size] * 2.2 : PEN_SIZES[size],
      erase: erasing,
      points: [pointOf(event)],
    };
    drawingRef.current = stroke;
    drawStroke(inkRef.current.getContext("2d"), stroke);
    setNotice("");
  };

  const extend = (event) => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    event.preventDefault();
    const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
    for (const e of events.length ? events : [event]) {
      const point = pointOf(e);
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 1.5) continue;
      stroke.points.push(point);
    }
    // Drawn as it goes: the last few points, smoothed.
    const ink = inkRef.current.getContext("2d");
    drawStroke(ink, { ...stroke, points: stroke.points.slice(-4) });
  };

  const end = () => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    drawingRef.current = null;
    setStrokes((list) => [...list, stroke]);
    setUndone([]);
  };

  const undo = useCallback(() => {
    if (!strokes.length) return;
    setUndone([...undone, strokes[strokes.length - 1]]);
    setStrokes(strokes.slice(0, -1));
  }, [strokes, undone]);
  const redo = useCallback(() => {
    if (!undone.length) return;
    setStrokes([...strokes, undone[undone.length - 1]]);
    setUndone(undone.slice(0, -1));
  }, [strokes, undone]);
  const clear = () => {
    if (!hasDrawing(strokes, background)) return;
    setUndone([]);
    setStrokes([]);
    setBackground(null);
  };

  const usePhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    // Kept as a canvas at the page's size: the file's link can go at once.
    image.onload = () => {
      const scale = Math.min(1, SIZE / Math.max(image.naturalWidth, image.naturalHeight));
      const copy = document.createElement("canvas");
      copy.width = Math.max(1, Math.round(image.naturalWidth * scale));
      copy.height = Math.max(1, Math.round(image.naturalHeight * scale));
      copy.getContext("2d").drawImage(image, 0, 0, copy.width, copy.height);
      URL.revokeObjectURL(url);
      setBackground(copy);
      setNotice("");
    };
    image.onerror = () => { URL.revokeObjectURL(url); setNotice("That file isn't a photo the app can read."); };
    image.src = url;
  };

  const make = () => {
    if (!hasDrawing(strokes, background)) { setNotice("Draw something first."); return; }
    const out = document.createElement("canvas");
    out.width = SIZE;
    out.height = SIZE;
    const ctx = out.getContext("2d");
    ctx.drawImage(pageRef.current, 0, 0);
    ctx.drawImage(inkRef.current, 0, 0);
    onSubmit({ image: out.toDataURL("image/png"), description: description.trim(), style });
  };

  // Ctrl/⌘+Z undoes, with Shift (or Y) redoes; Escape closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.("input, textarea")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, undo, redo]);

  const drawn = hasDrawing(strokes, background);

  return (
    <div className="dp-screen" role="dialog" aria-label="Doodle to picture">
      <header className="dp-bar">
        <button type="button" className="dp-icon" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div className="dp-title">Doodle</div>
        <div className="dp-bar-tools">
          <button type="button" className="dp-icon" onClick={undo} disabled={!strokes.length} aria-label="Undo"><Undo2 size={19} /></button>
          <button type="button" className="dp-icon" onClick={redo} disabled={!undone.length} aria-label="Redo"><Redo2 size={19} /></button>
          <button type="button" className="dp-icon" onClick={clear} disabled={!drawn} aria-label="Clear the page"><Trash2 size={18} /></button>
        </div>
      </header>

      <div className="dp-main">
        <div className="dp-page">
          <canvas ref={pageRef} width={SIZE} height={SIZE} className="dp-layer" aria-hidden="true" />
          <canvas
            ref={inkRef}
            width={SIZE}
            height={SIZE}
            className={`dp-layer dp-ink${erasing ? " is-erasing" : ""}`}
            onPointerDown={begin}
            onPointerMove={extend}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            role="img"
            aria-label="Drawing page: draw with your finger, a pen or the mouse"
          />
          {!drawn && <p className="dp-placeholder" aria-hidden="true">Draw something rough here</p>}
        </div>

        <div className="dp-tools" role="toolbar" aria-label="Pen">
          <div className="dp-colours">
            {PEN_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                className={`dp-swatch${!erasing && colour === c ? " is-on" : ""}`}
                style={{ "--swatch": c }}
                onClick={() => { setColour(c); setErasing(false); }}
                aria-label={c === "#ffffff" ? "White" : `Colour ${c}`}
                aria-pressed={!erasing && colour === c}
              />
            ))}
          </div>
          <div className="dp-tool-row">
            {Object.keys(PEN_SIZES).map((s) => (
              <button key={s} type="button" className={`dp-size${size === s ? " is-on" : ""}`} onClick={() => setSize(s)} aria-label={`Pen size ${s}`} aria-pressed={size === s}>
                <span style={{ width: PEN_SIZES[s] / 2.4 + 3, height: PEN_SIZES[s] / 2.4 + 3 }} />
              </button>
            ))}
            <button type="button" className={`dp-chip${erasing ? " is-on" : ""}`} onClick={() => setErasing((v) => !v)} aria-pressed={erasing}><Eraser size={16} /> Eraser</button>
            <button type="button" className="dp-chip" onClick={() => fileRef.current?.click()}><ImageUp size={16} /> Use a photo</button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={usePhoto} />
          </div>
        </div>

        <div className="dp-make">
          <input
            className="dp-describe"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") make(); }}
            placeholder="What is it? (optional) — e.g. a cat on a sofa"
            aria-label="What the doodle shows (optional)"
            maxLength={300}
          />
          <div className="dp-styles" role="radiogroup" aria-label="Turn it into">
            {DOODLE_STYLES.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={style === s.id} className={`dp-style${style === s.id ? " is-on" : ""}`} onClick={() => setStyle(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          {notice && <p className="dp-notice" role="alert">{notice}</p>}
          <button type="button" className="dp-go" onClick={make}><Sparkles size={17} /> Make it</button>
        </div>
      </div>
    </div>
  );
}
