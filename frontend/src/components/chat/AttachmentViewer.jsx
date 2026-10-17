import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { extractFileText } from "../../lib/fileText";
import "./AttachmentViewer.css";

// Full-screen view of an attachment: a picture to zoom into (pinch, double-tap,
// wheel; drag to look around), a PDF's pages, or the text of a Word, Excel,
// PowerPoint, text or code file. Several attachments: arrows / swipe / ← →.
//
// items: [{ name, size, src?, file? }] — `src` an image URL, `file` the File.

const isImageItem = (it) => (Boolean(it?.src) && !(isPdfItem(it) && it?.file)) || /^image\//.test(it?.file?.type || "") || /\.(jpe?g|png|gif|webp|bmp|svg|heic|avif)$/i.test(it?.name || "");
const isPdfItem = (it) => /\.pdf$/i.test(it?.name || "") || it?.file?.type === "application/pdf";

function ZoomableImage({ src, alt }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(0);

  const clamp = (v) => {
    const scale = Math.min(6, Math.max(1, v.scale));
    if (scale === 1) return { scale: 1, x: 0, y: 0 };
    const box = stageRef.current?.getBoundingClientRect();
    const maxX = box ? (box.width * (scale - 1)) / 2 : 0;
    const maxY = box ? (box.height * (scale - 1)) / 2 : 0;
    return { scale, x: Math.max(-maxX, Math.min(maxX, v.x)), y: Math.max(-maxY, Math.min(maxY, v.y)) };
  };
  // Zoom keeping the point under (cx, cy) — relative to the stage centre — still.
  const zoomAt = useCallback((next, cx = 0, cy = 0) => setView((v) => {
    const k = Math.min(6, Math.max(1, next)) / v.scale;
    return clamp({ scale: v.scale * k, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  }), []);
  const fromCentre = (e) => {
    const box = stageRef.current.getBoundingClientRect();
    return [e.clientX - box.left - box.width / 2, e.clientY - box.top - box.height / 2];
  };

  const onPointerDown = (e) => {
    stageRef.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { kind: "pinch", dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), start: view };
    } else {
      gesture.current = { kind: "pan", x: e.clientX, y: e.clientY, start: view };
      const now = Date.now();
      if (now - lastTap.current < 280) { const [cx, cy] = fromCentre(e); zoomAt(view.scale > 1 ? 1 : 2.5, cx, cy); }
      lastTap.current = now;
    }
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.kind === "pinch" && pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setView(clamp({ ...g.start, scale: g.start.scale * (dist / g.dist) }));
    } else if (g.kind === "pan" && g.start.scale > 1) {
      setView(clamp({ ...g.start, x: g.start.x + e.clientX - g.x, y: g.start.y + e.clientY - g.y }));
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
  };
  const onWheel = (e) => {
    const [cx, cy] = fromCentre(e);
    zoomAt(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), cx, cy);
  };

  return (
    <>
      <div
        ref={stageRef}
        className={`vav-stage${view.scale > 1 ? " is-zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      </div>
      <div className="vav-zoom">
        <button type="button" onClick={() => zoomAt(view.scale / 1.5)} disabled={view.scale <= 1} aria-label="Zoom out"><ZoomOut size={18} /></button>
        <span>{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoomAt(view.scale * 1.5)} disabled={view.scale >= 6} aria-label="Zoom in"><ZoomIn size={18} /></button>
      </div>
    </>
  );
}

let pdfjsLib = null;
async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.js?url")]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  pdfjsLib = lib;
  return lib;
}

// A PDF's pages as pictures — phones have no built-in PDF viewer for a page to use.
function PdfPages({ file }) {
  const holder = useRef(null);
  const [state, setState] = useState({ status: "loading", pages: 0 });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lib = await loadPdfjs();
        const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
        if (!alive) return;
        const total = Math.min(pdf.numPages, 50);
        setState({ status: "ready", pages: pdf.numPages });
        const width = Math.min(1000, (holder.current?.clientWidth || 800)) * Math.min(2, window.devicePixelRatio || 1);
        for (let n = 1; n <= total && alive; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: width / base.width });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "vav-pdf-page";
          canvas.setAttribute("aria-label", `Page ${n}`);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          if (alive) holder.current?.appendChild(canvas);
        }
      } catch (err) {
        if (alive) setState({ status: "error", message: err?.message || String(err) });
      }
    })();
    return () => { alive = false; };
  }, [file]);
  return (
    <div className="vav-doc">
      {state.status === "loading" && <p className="vav-note"><Loader2 size={16} className="animate-spin" /> Opening the PDF…</p>}
      {state.status === "error" && <p className="vav-note">This PDF couldn't be shown ({state.message}).</p>}
      {state.pages > 50 && <p className="vav-note">Showing the first 50 of {state.pages} pages.</p>}
      <div ref={holder} className="vav-pdf" />
    </div>
  );
}

function FileText_({ file }) {
  const [state, setState] = useState({ status: "loading" });
  useEffect(() => {
    let alive = true;
    extractFileText(file, 400000)
      .then((text) => alive && setState({ status: "ready", text }))
      .catch((err) => alive && setState({ status: "error", message: err?.message || String(err) }));
    return () => { alive = false; };
  }, [file]);
  if (state.status === "loading") return <div className="vav-doc"><p className="vav-note"><Loader2 size={16} className="animate-spin" /> Reading the file…</p></div>;
  if (state.status === "error" || !state.text?.trim()) {
    return <div className="vav-doc"><p className="vav-note"><FileText size={18} /> {state.status === "error" ? `This file couldn't be read (${state.message}).` : "There's no text to show in this file."}</p></div>;
  }
  return <div className="vav-doc"><pre className="vav-text">{state.text}</pre></div>;
}

function download(item) {
  const url = item.file ? URL.createObjectURL(item.file) : item.src;
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = item.name || "attachment";
  a.click();
  if (item.file) setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function AttachmentViewer({ items, index = 0, onClose }) {
  const [i, setI] = useState(index);
  const item = items[i];
  // A picture given as a File (not yet sent) is shown from a temporary URL.
  const objectUrl = useMemo(() => (item?.file && !item.src && isImageItem(item) ? URL.createObjectURL(item.file) : null), [item]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  const touch = useRef(null);
  const go = useCallback((d) => setI((n) => (n + d + items.length) % items.length), [items.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (items.length > 1 && e.key === "ArrowRight") go(1);
      if (items.length > 1 && e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [go, items.length, onClose]);

  if (!item) return null;
  const imageSrc = item.src || objectUrl;
  let body;
  // A PDF may come with a picture of its first page; with the file, show every page.
  if (isPdfItem(item) && item.file) body = <PdfPages key={i} file={item.file} />;
  else if (isImageItem(item) && imageSrc) body = <ZoomableImage key={i} src={imageSrc} alt={item.name || "Image"} />;
  else if (!item.file) body = <div className="vav-doc"><p className="vav-note"><FileText size={18} /> This file's contents aren't kept after the page reloads, so it can't be shown. Attach it again to see it.</p></div>;
  else if (isPdfItem(item)) body = <PdfPages key={i} file={item.file} />;
  else body = <FileText_ key={i} file={item.file} />;

  // A horizontal swipe on a picture that isn't zoomed moves to the next one.
  const onTouchStart = (e) => { touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; };
  const onTouchEnd = (e) => {
    const t = touch.current;
    touch.current = null;
    if (!t || items.length < 2 || document.querySelector(".vav-stage.is-zoomed")) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="vav" role="dialog" aria-modal="true" aria-label={item.name || "Attachment"} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="vav-bar">
        <span className="vav-title" title={item.name}>{item.name || "Attachment"}{items.length > 1 && <em>{i + 1} / {items.length}</em>}</span>
        {(item.file || item.src) && <button type="button" onClick={() => download(item)} aria-label="Download"><Download size={19} /></button>}
        <button type="button" onClick={onClose} aria-label="Close" autoFocus><X size={21} /></button>
      </div>
      <div className="vav-body" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>{body}</div>
      {items.length > 1 && (
        <>
          <button type="button" className="vav-nav is-prev" onClick={() => go(-1)} aria-label="Previous"><ChevronLeft size={24} /></button>
          <button type="button" className="vav-nav is-next" onClick={() => go(1)} aria-label="Next"><ChevronRight size={24} /></button>
        </>
      )}
    </div>
  );
}
