import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize2, MessageSquareText, Presentation } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { SLIDE_H, SLIDE_W, buildPptx, deckFileName, layoutDeck, parseDeck } from "../../../lib/slides";
import "./slides.css";

// A ```slides block: the deck the model wrote, drawn from the same layout the
// .pptx is built from (lib/slides.js). Positions are inches on the slide, and
// font sizes are points; the stage is a size container, so 1pt is
// 100/960 cqw (the slide is 13.333 in = 960 pt wide) at any width.

const pct = (v, total) => `${(v / total) * 100}%`;
const pt = (size) => `${(size / 960) * 100}cqw`;
const hex = (c) => `#${c}`;
const FONT_STACK = { Georgia: "Georgia, 'Times New Roman', serif", "Segoe UI": "'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif" };
const font = (f) => FONT_STACK[f] || f;

function box(sh) {
  return { left: pct(sh.x, SLIDE_W), top: pct(sh.y, SLIDE_H), width: pct(sh.w, SLIDE_W), height: pct(sh.h, SLIDE_H) };
}

function ChartPreview({ sh }) {
  const { chart, colors, textColor, gridColor } = sh;
  const W = 600;
  const H = Math.round((W * sh.h) / sh.w);
  const color = (i) => hex(colors[i % colors.length]);
  const legend = chart.type === "pie" || chart.type === "doughnut" ? chart.labels : chart.series.length > 1 ? chart.series.map((s) => s.name) : [];
  const legendH = legend.length ? 34 : 0;

  let body;
  if (chart.type === "pie" || chart.type === "doughnut") {
    const values = chart.series[0].values.map((v) => Math.max(0, v));
    const sum = values.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min(W, H - legendH) / 2 - 12;
    const cx = W / 2;
    const cy = (H - legendH) / 2;
    const starts = values.map((_, i) => -Math.PI / 2 + (values.slice(0, i).reduce((a, b) => a + b, 0) / sum) * Math.PI * 2);
    body = values.map((v, i) => {
      const a0 = starts[i];
      const a1 = a0 + (v / sum) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
      const d = v >= sum ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0` : `M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)} Z`;
      const mid = (a0 + a1) / 2;
      const lr = chart.type === "doughnut" ? r * 0.78 : r * 0.62;
      const label = v / sum >= 0.05 ? <text key={`t${i}`} x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid)} fill="#fff" fontSize="15" fontWeight="600" textAnchor="middle" dominantBaseline="middle">{Math.round((v / sum) * 100)}%</text> : null;
      return [<path key={i} d={d} fill={color(i)} />, label];
    });
    if (chart.type === "doughnut") body.push(<circle key="hole" cx={cx} cy={cy} r={r * 0.55} fill={hex(sh.hole)} />);
  } else {
    const padL = 44;
    const padB = 30;
    const plotW = W - padL - 10;
    const plotH = H - legendH - padB - 10;
    const all = chart.series.flatMap((s) => s.values);
    const max = Math.max(...all, 0);
    const min = Math.min(...all, 0);
    // Round gridlines: steps of 1, 2, 2.5 or 5 × 10^n, about four of them.
    const raw = (max - min) / 4 || 1;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.max(lo + step, Math.ceil(max / step) * step);
    const span = hi - lo;
    const y = (v) => 10 + plotH - ((v - lo) / span) * plotH;
    const ticks = Array.from({ length: Math.round(span / step) + 1 }, (_, i) => lo + step * i);
    const n = chart.labels.length;
    const slot = plotW / n;
    const fmt = (v) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(1)}`);
    body = [
      ...ticks.map((tk, i) => (
        <g key={`g${i}`}>
          <line x1={padL} x2={W - 10} y1={y(tk)} y2={y(tk)} stroke={hex(gridColor)} strokeWidth="1" />
          <text x={padL - 8} y={y(tk)} fill={hex(textColor)} fontSize="12" textAnchor="end" dominantBaseline="middle">{fmt(tk)}</text>
        </g>
      )),
      ...chart.labels.map((l, i) => <text key={`l${i}`} x={padL + slot * (i + 0.5)} y={H - legendH - 10} fill={hex(textColor)} fontSize="12" textAnchor="middle">{l.length > 14 ? `${l.slice(0, 13)}…` : l}</text>),
    ];
    if (chart.type === "line") {
      chart.series.forEach((s, si) => {
        const pts = s.values.map((v, i) => [padL + slot * (i + 0.5), y(v)]);
        body.push(<polyline key={`s${si}`} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color(si)} strokeWidth="3.5" strokeLinejoin="round" />);
        pts.forEach(([px, py], i) => body.push(<circle key={`c${si}-${i}`} cx={px} cy={py} r="5" fill={color(si)} />));
      });
    } else {
      const group = slot * 0.62;
      const bw = group / chart.series.length;
      chart.series.forEach((s, si) => s.values.forEach((v, i) => {
        const x = padL + slot * i + (slot - group) / 2 + si * bw;
        body.push(<rect key={`b${si}-${i}`} x={x + 1} y={Math.min(y(v), y(0))} width={Math.max(1, bw - 2)} height={Math.abs(y(v) - y(0))} fill={color(si)} />);
      }));
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ fontFamily: font(sh.font) }}>
      {body}
      {legend.length > 0 && (
        <g transform={`translate(${W / 2}, ${H - 12})`}>
          {legend.map((name, i) => {
            const x = (i - (legend.length - 1) / 2) * 92;
            return (
              <g key={i} transform={`translate(${x}, 0)`}>
                <rect x="-40" y="-6" width="11" height="11" fill={color(i)} />
                <text x="-24" y="0" fill={hex(textColor)} fontSize="12" dominantBaseline="middle">{name.length > 10 ? `${name.slice(0, 9)}…` : name}</text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

function Shape({ sh, bg }) {
  const style = { position: "absolute", ...box(sh) };
  if (sh.type === "rect" || sh.type === "ellipse") {
    return (
      <div style={{
        ...style,
        background: hex(sh.fill),
        opacity: sh.transparency ? 1 - sh.transparency / 100 : 1,
        borderRadius: sh.type === "ellipse" ? "50%" : sh.radius ? pt(sh.radius * 72) : 0,
        boxShadow: sh.line ? `inset 0 0 0 1px ${hex(sh.line)}` : undefined,
      }} />
    );
  }
  if (sh.type === "text") {
    const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[sh.valign || "top"];
    return (
      <div className="vetro-slide-text" style={{
        ...style, justifyContent: justify, textAlign: sh.align || "left", color: hex(sh.color), fontFamily: font(sh.font),
        fontSize: pt(sh.size), fontWeight: sh.bold ? 700 : 400, fontStyle: sh.italic ? "italic" : "normal",
        letterSpacing: sh.charSpacing ? pt(sh.charSpacing) : undefined,
      }}>
        <span>{sh.text}</span>
      </div>
    );
  }
  if (sh.type === "bullets") {
    return (
      <ul className="vetro-slide-bullets" style={{ ...style, color: hex(sh.color), fontFamily: font(sh.font), fontSize: pt(sh.size), "--bullet": hex(sh.bulletColor) }}>
        {sh.items.map((b, i) => (
          <li key={i} className={b.level ? "is-sub" : ""} style={{ marginBottom: pt(sh.size * 0.6) }}>{b.text}</li>
        ))}
      </ul>
    );
  }
  if (sh.type === "chart") {
    return <div style={style}><ChartPreview sh={{ ...sh, hole: sh.hole || bg }} /></div>;
  }
  if (sh.type === "table") {
    const rowStyle = { height: pt(sh.rowH * 72) };
    return (
      <table className="vetro-slide-table" style={{ position: "absolute", left: style.left, top: style.top, width: style.width, fontFamily: font(sh.font), fontSize: pt(sh.size), "--border": hex(sh.border) }}>
        {sh.headers && (
          <thead><tr style={rowStyle}>{sh.headers.map((h, i) => <th key={i} style={{ background: hex(sh.headFill), color: hex(sh.headColor) }}>{h}</th>)}</tr></thead>
        )}
        <tbody>
          {sh.rows.map((r, ri) => (
            <tr key={ri} style={{ ...rowStyle, background: hex(ri % 2 ? sh.altFill : sh.fill), color: hex(sh.color) }}>
              {r.map((c, ci) => <td key={ci}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return null;
}

export function SlideView({ page, className = "" }) {
  return (
    <div className={`vetro-slide ${className}`} style={{ background: hex(page.bg) }}>
      {page.shapes.map((sh, i) => <Shape key={i} sh={sh} bg={page.bg} />)}
    </div>
  );
}

export default function SlidesBlock({ code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const parsed = useMemo(() => {
    if (pending) return null;
    try {
      const deck = parseDeck(code);
      return { deck, pages: layoutDeck(deck) };
    } catch (err) { return { error: String(err.message || err).split("\n")[0] }; }
  }, [code, pending]);

  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const stageRef = useRef(null);
  const total = parsed?.pages?.length || 0;
  const go = useCallback((d) => setIndex((i) => Math.max(0, Math.min(total - 1, i + d))), [total]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onKey = (e) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
    };
    stage.addEventListener("keydown", onKey);
    return () => stage.removeEventListener("keydown", onKey);
  }, [go, parsed]);

  if (pending) return <VisualPending icon={Presentation} label="Designing your slides…" sketch="diagram" />;
  if (parsed?.error) return <VisualFallback what="presentation" error={parsed.error} fallback={fallback} />;

  const { deck, pages } = parsed;
  const page = pages[Math.min(index, total - 1)];

  const download = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const { default: PptxGenJS } = await import("pptxgenjs");
      await buildPptx(deck, PptxGenJS).writeFile({ fileName: deckFileName(deck) });
    } catch (err) {
      setSaveError(`Couldn’t create the file (${err?.message || err}).`);
    } finally {
      setSaving(false);
    }
  };

  const present = () => {
    const stage = stageRef.current;
    stage?.focus();
    stage?.requestFullscreen?.().catch(() => {});
  };

  return (
    <VisualCard icon={Presentation} title={`${deck.title} · ${total} slides`} code={code} bodyClassName="vetro-slides-body">
      <div className="vetro-slides">
        <div
          ref={stageRef}
          className="vetro-slides-stage"
          tabIndex={0}
          aria-roledescription="slide deck"
          aria-label={`Slide ${index + 1} of ${total}`}
          onClick={(e) => { if (document.fullscreenElement === stageRef.current) go(e.clientX > window.innerWidth / 2 ? 1 : -1); }}
        >
          <SlideView page={page} />
          <button type="button" className="vetro-slides-nav is-prev" onClick={(e) => { e.stopPropagation(); go(-1); }} disabled={index === 0} aria-label="Previous slide"><ChevronLeft size={20} /></button>
          <button type="button" className="vetro-slides-nav is-next" onClick={(e) => { e.stopPropagation(); go(1); }} disabled={index >= total - 1} aria-label="Next slide"><ChevronRight size={20} /></button>
        </div>

        <div className="vetro-slides-bar">
          <span className="vetro-slides-count">{index + 1} / {total}</span>
          <span className="vetro-slides-actions">
            {page.notes && (
              <button type="button" className={showNotes ? "is-on" : ""} onClick={() => setShowNotes((v) => !v)} aria-pressed={showNotes}>
                <MessageSquareText size={15} /> Notes
              </button>
            )}
            <button type="button" onClick={present}><Maximize2 size={15} /> Present</button>
            <button type="button" className="is-primary" onClick={download} disabled={saving}>
              {saving ? <Loader2 size={15} className="vetro-spin" /> : <Download size={15} />} Download .pptx
            </button>
          </span>
        </div>
        {saveError && <p className="vetro-slides-error">{saveError}</p>}
        {showNotes && page.notes && <p className="vetro-slides-notes"><strong>Speaker notes:</strong> {page.notes}</p>}

        <div className="vetro-slides-thumbs" role="tablist" aria-label="Slides">
          {pages.map((p, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === index} aria-label={`Slide ${i + 1}`} className={`vetro-slides-thumb ${i === index ? "is-active" : ""}`} onClick={() => setIndex(i)}>
              <SlideView page={p} />
            </button>
          ))}
        </div>
      </div>
    </VisualCard>
  );
}
