// A ```slides block: a presentation the model writes as JSON. The chat shows
// it as slides to flip through or present, and downloads it as an editable
// .pptx (PptxGenJS). Both draw from the same layout: layoutSlide() turns each
// slide into positioned shapes measured in inches on a 13.333 × 7.5 in (16:9)
// page, so the preview matches the file.
//
// {"title": "…", "subtitle": "…", "theme": "midnight", "slides": [
//   {"layout": "title", "title": "…", "subtitle": "…", "kicker": "…", "notes": "…"},
//   {"layout": "bullets", "title": "…", "bullets": ["…", {"text": "…", "sub": ["…"]}], "takeaway": "…"},
//   {"layout": "two-column", "title": "…", "left": {"heading": "…", "bullets": []}, "right": {…}},
//   {"layout": "stats", "title": "…", "stats": [{"value": "72%", "label": "…"}], "caption": "…"},
//   {"layout": "process", "title": "…", "steps": [{"title": "…", "text": "…"}]},
//   {"layout": "chart", "title": "…", "chart": {"type": "bar", "labels": [], "series": [{"name": "…", "values": []}]}, "bullets": []},
//   {"layout": "table", "title": "…", "headers": [], "rows": [[]]},
//   {"layout": "quote", "quote": "…", "author": "…"},
//   {"layout": "section", "title": "…", "subtitle": "…"},
//   {"layout": "closing", "title": "…", "subtitle": "…"}]}

// A request for a presentation. Only used to give the reply room for a whole
// deck (the JSON for 10–12 slides with speaker notes runs to several thousand
// tokens), so a false positive costs nothing.
export const wantsSlides = (text) => /\b(pptx?|power ?point|slides?|slide ?deck|presentation|keynote)\b/i.test(String(text || ""));
export const SLIDES_MAX_TOKENS = 12000;

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

export const THEMES = {
  midnight: { dark: true, bg: "0B1020", surface: "161D3A", text: "F4F6FF", muted: "A3ADCF", accent: "7C9CFF", accent2: "35D6BE", onAccent: "0B1020", series: ["7C9CFF", "35D6BE", "F7B955", "F2709C", "B794F6"], head: "Segoe UI", body: "Segoe UI" },
  ocean: { dark: false, bg: "F5F9FC", surface: "FFFFFF", text: "0E2A3B", muted: "4F6B7D", accent: "0E7490", accent2: "F59E0B", onAccent: "FFFFFF", series: ["0E7490", "F59E0B", "38BDF8", "10B981", "6366F1"], head: "Segoe UI", body: "Segoe UI" },
  sunset: { dark: true, bg: "1E1224", surface: "2D1C36", text: "FFF4EC", muted: "D7B7C4", accent: "FF7A59", accent2: "FFC145", onAccent: "1E1224", series: ["FF7A59", "FFC145", "F472B6", "60A5FA", "34D399"], head: "Georgia", body: "Segoe UI" },
  forest: { dark: false, bg: "F3F6F1", surface: "FFFFFF", text: "1C2A1F", muted: "5A6B5C", accent: "2F7D4F", accent2: "C49A2C", onAccent: "FFFFFF", series: ["2F7D4F", "C49A2C", "6BAF8B", "8C6D46", "4A7FA8"], head: "Georgia", body: "Segoe UI" },
  minimal: { dark: false, bg: "FFFFFF", surface: "F3F4F6", text: "111827", muted: "6B7280", accent: "2563EB", accent2: "F97316", onAccent: "FFFFFF", series: ["2563EB", "F97316", "10B981", "A855F7", "EF4444"], head: "Segoe UI", body: "Segoe UI" },
  royal: { dark: true, bg: "140F2E", surface: "221A49", text: "F8F6FF", muted: "B8B1DA", accent: "A78BFA", accent2: "F472B6", onAccent: "140F2E", series: ["A78BFA", "F472B6", "60A5FA", "FBBF24", "34D399"], head: "Georgia", body: "Segoe UI" },
  corporate: { dark: false, bg: "FFFFFF", surface: "EEF2F8", text: "1A2433", muted: "5A6678", accent: "1E3A8A", accent2: "0EA5E9", onAccent: "FFFFFF", series: ["1E3A8A", "0EA5E9", "64748B", "F59E0B", "10B981"], head: "Segoe UI", body: "Segoe UI" },
};

const LAYOUTS = ["title", "section", "bullets", "two-column", "stats", "process", "chart", "table", "quote", "closing"];
const LAYOUT_ALIASES = { cover: "title", intro: "title", divider: "section", content: "bullets", list: "bullets", columns: "two-column", comparison: "two-column", compare: "two-column", twocolumn: "two-column", "two_column": "two-column", numbers: "stats", metrics: "stats", timeline: "process", steps: "process", roadmap: "process", graph: "chart", end: "closing", conclusion: "closing", "thank-you": "closing", thanks: "closing" };

const str = (v) => (v == null ? "" : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

function bulletItems(v) {
  return list(v).flatMap((b) => {
    if (b && typeof b === "object") {
      const text = str(b.text ?? b.title ?? b.point);
      const sub = list(b.sub ?? b.subpoints ?? b.bullets).map(str).filter(Boolean);
      return [...(text ? [{ text, level: 0 }] : []), ...sub.map((s) => ({ text: s, level: 1 }))];
    }
    const text = str(b);
    return text ? [{ text, level: 0 }] : [];
  });
}

function column(c) {
  if (!c || typeof c !== "object") return { heading: "", bullets: bulletItems(c) };
  return { heading: str(c.heading ?? c.title), bullets: bulletItems(c.bullets ?? c.points ?? c.items) };
}

const toNumber = (v) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function chartSpec(c) {
  if (!c || typeof c !== "object") return null;
  const type = ["bar", "line", "pie", "doughnut"].includes(str(c.type).toLowerCase()) ? str(c.type).toLowerCase() : "bar";
  const labels = list(c.labels).map(str);
  let series = list(c.series ?? c.datasets).map((s, i) => ({ name: str(s?.name ?? s?.label) || `Series ${i + 1}`, values: list(s?.values ?? s?.data).map(toNumber) }));
  if (!series.length && Array.isArray(c.values)) series = [{ name: str(c.name) || "Value", values: c.values.map(toNumber) }];
  series = series.filter((s) => s.values.length);
  if (!labels.length || !series.length) return null;
  if (type === "pie" || type === "doughnut") series = series.slice(0, 1);
  return { type, labels, series: series.map((s) => ({ ...s, values: labels.map((_, i) => s.values[i] ?? 0) })) };
}

function normalizeSlide(raw) {
  const s = raw && typeof raw === "object" ? raw : { title: str(raw) };
  let layout = str(s.layout ?? s.type).toLowerCase().replace(/\s+/g, "-");
  layout = LAYOUT_ALIASES[layout] || layout;
  const slide = {
    layout,
    title: str(s.title ?? s.heading),
    subtitle: str(s.subtitle),
    kicker: str(s.kicker ?? s.eyebrow),
    notes: str(s.notes ?? s.speakerNotes ?? s.speaker_notes),
    bullets: bulletItems(s.bullets ?? s.points ?? s.content),
    takeaway: str(s.takeaway ?? s.highlight ?? s.callout),
    left: column(s.left),
    right: column(s.right),
    stats: list(s.stats ?? s.metrics).map((x) => ({ value: str(x?.value ?? x?.number), label: str(x?.label ?? x?.text) })).filter((x) => x.value).slice(0, 4),
    caption: str(s.caption),
    steps: list(s.steps ?? s.timeline ?? s.items).map((x) => (typeof x === "object" && x ? { title: str(x.title ?? x.label ?? x.date), text: str(x.text ?? x.description) } : { title: str(x), text: "" })).filter((x) => x.title || x.text).slice(0, 6),
    chart: chartSpec(s.chart),
    headers: list(s.headers ?? s.table?.headers).map(str).slice(0, 6),
    rows: list(s.rows ?? s.table?.rows).map((r) => list(r).map(str).slice(0, 6)).slice(0, 8),
    quote: str(s.quote ?? s.text),
    author: str(s.author ?? s.attribution),
  };
  if (!LAYOUTS.includes(layout)) {
    // Unknown or missing layout: pick the one its content fits.
    slide.layout = slide.chart ? "chart" : slide.stats.length ? "stats" : slide.steps.length ? "process"
      : slide.rows.length ? "table" : (slide.left.bullets.length && slide.right.bullets.length) ? "two-column"
        : slide.quote && !slide.bullets.length ? "quote" : "bullets";
  }
  if (slide.layout === "chart" && !slide.chart) slide.layout = "bullets";
  if (slide.layout === "table" && !slide.rows.length) slide.layout = "bullets";
  if (slide.layout === "stats" && !slide.stats.length) slide.layout = "bullets";
  if (slide.layout === "process" && !slide.steps.length) slide.layout = "bullets";
  return slide;
}

// A reply cut off mid-deck still parses: drop the unfinished slide and close
// the JSON.
function parseLenient(text) {
  const clean = text.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(clean); } catch (err) {
    for (let i = clean.lastIndexOf("}"), tries = 0; i > 0 && tries < 400; i = clean.lastIndexOf("}", i - 1), tries++) {
      try { return JSON.parse(clean.slice(0, i + 1) + "]}"); } catch { /* keep trimming */ }
    }
    throw err;
  }
}

export function parseDeck(code) {
  const data = parseLenient(String(code).trim());
  const rawSlides = Array.isArray(data) ? data : data?.slides;
  if (!Array.isArray(rawSlides) || !rawSlides.length) throw new Error("no slides");
  const slides = rawSlides.map(normalizeSlide);
  const title = str(Array.isArray(data) ? "" : data.title) || slides[0].title || "Presentation";
  const themeName = str(data?.theme).toLowerCase();
  return {
    title,
    subtitle: str(data?.subtitle),
    themeName: THEMES[themeName] ? themeName : "midnight",
    slides,
  };
}

// ─── Text fitting ───────────────────────────────────────────────────────────
// Largest font size (pt) at which these paragraphs fit the box, estimated
// from an average character width. Used for both the preview and the file so
// long content shrinks instead of spilling off the slide.
const CHAR_W = 0.5; // average glyph width as a fraction of the font size
const BOLD_CHAR_W = 0.6; // big bold headings and numbers run wider
const LINE_H = 1.2;
export function fitFontSize(paragraphs, w, h, max, min = 10, gapRatio = 0.6) {
  const paras = paragraphs.filter((p) => p.text);
  if (!paras.length) return max;
  for (let pt = max; pt > min; pt -= 1) {
    let height = 0;
    for (const p of paras) {
      const size = pt * (p.scale || 1);
      const indent = (p.indent || 0) + (p.bullet ? size * 1.1 / 72 : 0);
      const perLine = Math.max(1, Math.floor(((w - indent) * 72) / (size * (p.charW || (p.bold ? BOLD_CHAR_W : CHAR_W)))));
      const lines = Math.ceil(p.text.length / perLine) || 1;
      height += (lines * size * LINE_H) / 72 + (size * gapRatio) / 72;
    }
    if (height <= h) return pt;
  }
  return min;
}

// ─── Layout ─────────────────────────────────────────────────────────────────
// Shapes: rect | ellipse | text | bullets | chart | table. Coordinates in inches.

const M = 0.7; // side margin
const CONTENT_Y = 1.75;
const CONTENT_H = 5.0;

function header(t, slide, shapes) {
  const size = fitFontSize([{ text: slide.title, bold: true }], SLIDE_W - 2 * M, 0.95, 32, 20, 0);
  shapes.push({ type: "text", x: M, y: 0.45, w: SLIDE_W - 2 * M, h: 0.95, text: slide.title, size, bold: true, color: t.text, font: t.head, valign: "bottom" });
  shapes.push({ type: "rect", x: M, y: 1.47, w: 0.9, h: 0.07, fill: t.accent });
}

function footer(t, deck, index, total, shapes) {
  shapes.push({ type: "text", x: M, y: 6.98, w: 8, h: 0.3, text: deck.title, size: 10, color: t.muted, font: t.body, valign: "middle" });
  shapes.push({ type: "text", x: SLIDE_W - M - 1.5, y: 6.98, w: 1.5, h: 0.3, text: `${index + 1} / ${total}`, size: 10, color: t.muted, font: t.body, align: "right", valign: "middle" });
}

function bulletsShape(t, items, x, y, w, h, max = 22, color) {
  const paras = items.map((b) => ({ text: b.text, bullet: true, scale: b.level ? 0.85 : 1, indent: b.level ? 0.4 : 0 }));
  const size = fitFontSize(paras, w, h, max, 11);
  return { type: "bullets", x, y, w, h, items, size, color: color || t.text, bulletColor: t.accent, font: t.body };
}

function card(t, x, y, w, h, fill) {
  return { type: "rect", x, y, w, h, fill: fill || t.surface, radius: 0.12, line: t.dark ? null : "E3E7EE" };
}

const LAYOUT_FNS = {
  title(t, s, deck) {
    const shapes = [
      { type: "rect", x: 8.75, y: 0, w: SLIDE_W - 8.75, h: SLIDE_H, fill: t.surface },
      { type: "ellipse", x: 9.35, y: 1.15, w: 3.3, h: 3.3, fill: t.accent },
      { type: "ellipse", x: 11.15, y: 4.25, w: 1.75, h: 1.75, fill: t.accent2 },
      { type: "ellipse", x: 9.0, y: 5.1, w: 0.7, h: 0.7, fill: t.muted, transparency: 55 },
      { type: "rect", x: 0.8, y: 1.95, w: 1.2, h: 0.08, fill: t.accent },
    ];
    const kicker = s.kicker;
    if (kicker) shapes.push({ type: "text", x: 0.8, y: 1.35, w: 7.6, h: 0.45, text: kicker.toUpperCase(), size: 13, bold: true, color: t.accent, font: t.body, charSpacing: 2, valign: "bottom" });
    const title = s.title || deck.title;
    shapes.push({ type: "text", x: 0.8, y: 2.2, w: 7.6, h: 2.3, text: title, size: fitFontSize([{ text: title, bold: true }], 7.6, 2.3, 50, 28, 0), bold: true, color: t.text, font: t.head, valign: "top" });
    const sub = s.subtitle || deck.subtitle;
    if (sub) shapes.push({ type: "text", x: 0.8, y: 4.65, w: 7.4, h: 1.3, text: sub, size: fitFontSize([{ text: sub }], 7.4, 1.3, 20, 13, 0), color: t.muted, font: t.body, valign: "top" });
    return { bg: t.bg, shapes, noFooter: true };
  },

  section(t, s, deck, index) {
    const number = String(deck.slides.slice(0, index + 1).filter((x) => x.layout === "section").length).padStart(2, "0");
    const shapes = [
      { type: "rect", x: 0, y: 0, w: 0.28, h: SLIDE_H, fill: t.accent },
      { type: "text", x: 1.1, y: 1.5, w: 4, h: 1.5, text: number, size: 80, bold: true, color: t.accent, font: t.head, valign: "bottom" },
      { type: "text", x: 1.1, y: 3.15, w: 10.5, h: 1.6, text: s.title, size: fitFontSize([{ text: s.title, bold: true }], 10.5, 1.6, 44, 26, 0), bold: true, color: t.text, font: t.head, valign: "top" },
    ];
    if (s.subtitle) shapes.push({ type: "text", x: 1.1, y: 4.85, w: 10.5, h: 1.0, text: s.subtitle, size: fitFontSize([{ text: s.subtitle }], 10.5, 1.0, 20, 13, 0), color: t.muted, font: t.body, valign: "top" });
    return { bg: t.surface, shapes };
  },

  bullets(t, s) {
    const shapes = [];
    header(t, s, shapes);
    const items = s.bullets.length ? s.bullets : [{ text: s.subtitle || s.caption || "", level: 0 }];
    if (s.takeaway) {
      shapes.push(card(t, M, CONTENT_Y, 7.75, CONTENT_H));
      shapes.push(bulletsShape(t, items, M + 0.4, CONTENT_Y + 0.35, 7.0, CONTENT_H - 0.7));
      const x = M + 8.05;
      const w = SLIDE_W - M - x;
      shapes.push({ type: "rect", x, y: CONTENT_Y, w, h: CONTENT_H, fill: t.accent, radius: 0.12 });
      shapes.push({ type: "text", x: x + 0.35, y: CONTENT_Y + 0.35, w: w - 0.7, h: 0.4, text: "KEY TAKEAWAY", size: 12, bold: true, color: t.onAccent, font: t.body, charSpacing: 2 });
      shapes.push({ type: "text", x: x + 0.35, y: CONTENT_Y + 0.9, w: w - 0.7, h: CONTENT_H - 1.25, text: s.takeaway, size: fitFontSize([{ text: s.takeaway }], w - 0.7, CONTENT_H - 1.25, 24, 13, 0), bold: true, color: t.onAccent, font: t.head, valign: "top" });
    } else {
      shapes.push(card(t, M, CONTENT_Y, SLIDE_W - 2 * M, CONTENT_H));
      shapes.push(bulletsShape(t, items, M + 0.5, CONTENT_Y + 0.4, SLIDE_W - 2 * M - 1.0, CONTENT_H - 0.8, 24));
    }
    return { bg: t.bg, shapes };
  },

  "two-column"(t, s) {
    const shapes = [];
    header(t, s, shapes);
    const gap = 0.35;
    const w = (SLIDE_W - 2 * M - gap) / 2;
    [s.left, s.right].forEach((col, i) => {
      const x = M + i * (w + gap);
      const color = i ? t.accent2 : t.accent;
      shapes.push(card(t, x, CONTENT_Y, w, CONTENT_H));
      shapes.push({ type: "rect", x, y: CONTENT_Y, w, h: 0.09, fill: color });
      let top = CONTENT_Y + 0.35;
      if (col.heading) {
        shapes.push({ type: "text", x: x + 0.4, y: top, w: w - 0.8, h: 0.6, text: col.heading, size: fitFontSize([{ text: col.heading }], w - 0.8, 0.6, 22, 14, 0), bold: true, color, font: t.head, valign: "middle" });
        top += 0.8;
      }
      shapes.push(bulletsShape(t, col.bullets, x + 0.4, top, w - 0.8, CONTENT_Y + CONTENT_H - top - 0.3, 20));
    });
    return { bg: t.bg, shapes };
  },

  stats(t, s) {
    const shapes = [];
    header(t, s, shapes);
    const n = s.stats.length;
    const gap = 0.35;
    const h = s.caption ? 3.4 : CONTENT_H - 0.4;
    const w = (SLIDE_W - 2 * M - gap * (n - 1)) / n;
    const top = CONTENT_Y + 0.2;
    s.stats.forEach((st, i) => {
      const x = M + i * (w + gap);
      shapes.push(card(t, x, top, w, h));
      shapes.push({ type: "rect", x: x + 0.4, y: top + 0.4, w: 0.6, h: 0.07, fill: t.series[i % t.series.length] });
      shapes.push({ type: "text", x: x + 0.4, y: top + 0.6, w: w - 0.8, h: 1.4, text: st.value, size: fitFontSize([{ text: st.value, charW: 0.82 }], w - 0.8, 1.0, 60, 22, 0) /* one line; big numerals run wide */, bold: true, color: t.series[i % t.series.length], font: t.head, valign: "middle" });
      shapes.push({ type: "text", x: x + 0.4, y: top + 2.1, w: w - 0.8, h: h - 2.4, text: st.label, size: fitFontSize([{ text: st.label }], w - 0.8, h - 2.4, 18, 11, 0), color: t.muted, font: t.body, valign: "top" });
    });
    if (s.caption) shapes.push({ type: "text", x: M, y: top + h + 0.3, w: SLIDE_W - 2 * M, h: 1.0, text: s.caption, size: fitFontSize([{ text: s.caption }], SLIDE_W - 2 * M, 1.0, 20, 12, 0), color: t.text, font: t.body, valign: "middle" });
    return { bg: t.bg, shapes };
  },

  process(t, s) {
    const shapes = [];
    header(t, s, shapes);
    const n = s.steps.length;
    const gap = 0.3;
    const w = (SLIDE_W - 2 * M - gap * (n - 1)) / n;
    const circle = 0.8;
    const cy = CONTENT_Y + 0.35;
    shapes.push({ type: "rect", x: M + w / 2, y: cy + circle / 2 - 0.025, w: (n - 1) * (w + gap), h: 0.05, fill: t.muted, transparency: 50 });
    // Each step has its own box; all share the size of the tightest one.
    const titleSize = Math.min(...s.steps.map((st) => fitFontSize([{ text: st.title, bold: true }], w - 0.5, 0.75, 20, 12, 0)));
    const textSize = Math.min(...s.steps.map((st) => fitFontSize([{ text: st.text }], w - 0.5, 2.3, 16, 10, 0)));
    s.steps.forEach((st, i) => {
      const x = M + i * (w + gap);
      const color = t.series[i % t.series.length];
      shapes.push({ type: "ellipse", x: x + w / 2 - circle / 2, y: cy, w: circle, h: circle, fill: color });
      shapes.push({ type: "text", x: x + w / 2 - circle / 2, y: cy, w: circle, h: circle, text: String(i + 1), size: 22, bold: true, color: t.dark ? t.bg : "FFFFFF", font: t.head, align: "center", valign: "middle" });
      shapes.push(card(t, x, cy + circle + 0.3, w, CONTENT_Y + CONTENT_H - (cy + circle + 0.3)));
      shapes.push({ type: "text", x: x + 0.25, y: cy + circle + 0.5, w: w - 0.5, h: 0.75, text: st.title, size: titleSize, bold: true, color: t.text, font: t.head, valign: "top" });
      if (st.text) shapes.push({ type: "text", x: x + 0.25, y: cy + circle + 1.3, w: w - 0.5, h: 2.3, text: st.text, size: textSize, color: t.muted, font: t.body, valign: "top" });
    });
    return { bg: t.bg, shapes };
  },

  chart(t, s) {
    const shapes = [];
    header(t, s, shapes);
    const side = s.bullets.length ? 4.0 : 0;
    const w = SLIDE_W - 2 * M - (side ? side + 0.35 : 0);
    shapes.push(card(t, M, CONTENT_Y, w, CONTENT_H));
    shapes.push({ type: "chart", x: M + 0.25, y: CONTENT_Y + 0.2, w: w - 0.5, h: CONTENT_H - 0.4, chart: s.chart, colors: t.series, hole: t.surface, textColor: t.muted, gridColor: t.dark ? "3A4466" : "DDE3EA", font: t.body });
    if (side) {
      const x = SLIDE_W - M - side;
      shapes.push({ type: "rect", x, y: CONTENT_Y, w: side, h: CONTENT_H, fill: t.surface, radius: 0.12, line: t.dark ? null : "E3E7EE" });
      shapes.push({ type: "rect", x, y: CONTENT_Y, w: 0.09, h: CONTENT_H, fill: t.accent });
      shapes.push({ type: "text", x: x + 0.4, y: CONTENT_Y + 0.3, w: side - 0.7, h: 0.4, text: "INSIGHTS", size: 12, bold: true, color: t.accent, font: t.body, charSpacing: 2 });
      shapes.push(bulletsShape(t, s.bullets, x + 0.4, CONTENT_Y + 0.85, side - 0.7, CONTENT_H - 1.15, 18));
    }
    return { bg: t.bg, shapes };
  },

  table(t, s) {
    const shapes = [];
    header(t, s, shapes);
    const cols = Math.max(s.headers.length, ...s.rows.map((r) => r.length));
    const headers = s.headers.length ? [...s.headers, ...Array(cols - s.headers.length).fill("")] : null;
    const rows = s.rows.map((r) => [...r, ...Array(cols - r.length).fill("")]);
    const rowCount = rows.length + (headers ? 1 : 0);
    const rowH = Math.min(0.75, CONTENT_H / rowCount);
    const longest = Math.max(...[headers || [], ...rows].flat().map((c) => c.length), 1);
    const colW = (SLIDE_W - 2 * M) / cols;
    const size = Math.max(10, Math.min(18, fitFontSize([{ text: "x".repeat(longest) }], colW - 0.3, rowH - 0.1, 18, 10, 0)));
    shapes.push({ type: "table", x: M, y: CONTENT_Y, w: SLIDE_W - 2 * M, rowH, headers, rows, size, font: t.body, headFill: t.accent, headColor: t.onAccent, color: t.text, fill: t.surface, altFill: t.bg, border: t.dark ? "2C365A" : "DDE3EA" });
    return { bg: t.bg, shapes };
  },

  quote(t, s) {
    const text = s.quote || s.title;
    return {
      bg: t.surface,
      shapes: [
        { type: "text", x: 1.0, y: 0.6, w: 2, h: 2, text: "“", size: 160, bold: true, color: t.accent, font: "Georgia", valign: "top" },
        { type: "text", x: 1.6, y: 2.0, w: 10.1, h: 3.2, text, size: fitFontSize([{ text }], 10.1, 3.2, 36, 18, 0), italic: true, color: t.text, font: t.head, valign: "middle" },
        { type: "rect", x: 1.6, y: 5.55, w: 0.9, h: 0.07, fill: t.accent2 },
        ...(s.author ? [{ type: "text", x: 1.6, y: 5.75, w: 10.1, h: 0.6, text: `— ${s.author}`, size: 18, bold: true, color: t.accent2, font: t.body, valign: "top" }] : []),
      ],
    };
  },

  closing(t, s, deck) {
    const title = s.title || "Thank you";
    const shapes = [
      { type: "ellipse", x: -1.6, y: -1.8, w: 4.6, h: 4.6, fill: t.accent },
      { type: "ellipse", x: 10.9, y: 4.9, w: 3.6, h: 3.6, fill: t.accent2 },
      { type: "text", x: 1.5, y: 2.2, w: SLIDE_W - 3, h: 1.7, text: title, size: fitFontSize([{ text: title, bold: true }], SLIDE_W - 3, 1.7, 54, 28, 0), bold: true, color: t.text, font: t.head, align: "center", valign: "middle" },
      { type: "rect", x: SLIDE_W / 2 - 0.6, y: 4.05, w: 1.2, h: 0.08, fill: t.accent },
    ];
    const sub = s.subtitle || (s.bullets.length ? "" : deck.subtitle);
    if (sub) shapes.push({ type: "text", x: 1.8, y: 4.35, w: SLIDE_W - 3.6, h: 1.4, text: sub, size: fitFontSize([{ text: sub }], SLIDE_W - 3.6, 1.4, 22, 13, 0), color: t.muted, font: t.body, align: "center", valign: "top" });
    else if (s.bullets.length) shapes.push(bulletsShape(t, s.bullets, 3.4, 4.35, SLIDE_W - 6.8, 2.2, 18, t.muted));
    return { bg: t.bg, shapes, noFooter: true };
  },
};

export function layoutSlide(deck, index) {
  const t = THEMES[deck.themeName] || THEMES.midnight;
  const slide = deck.slides[index];
  const out = LAYOUT_FNS[slide.layout](t, slide, deck, index);
  if (!out.noFooter) footer(t, deck, index, deck.slides.length, out.shapes);
  return { ...out, notes: slide.notes };
}

export const layoutDeck = (deck) => deck.slides.map((_, i) => layoutSlide(deck, i));

export function deckFileName(deck) {
  const base = deck.title.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Presentation";
  return `${base}.pptx`;
}

// ─── PowerPoint export ──────────────────────────────────────────────────────
// PptxGenJS is passed in (lazy-loaded by the UI; required directly in tests).
export function buildPptx(deck, PptxGenJS) {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.title = deck.title;
  pres.subject = deck.subtitle || deck.title;
  pres.company = "VetroAI";
  for (const page of layoutDeck(deck)) {
    const slide = pres.addSlide();
    slide.background = { color: page.bg };
    for (const sh of page.shapes) addShape(pres, slide, sh);
    if (page.notes) slide.addNotes(page.notes);
  }
  return pres;
}

function addShape(pres, slide, sh) {
  const box = { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
  if (sh.type === "rect" || sh.type === "ellipse") {
    const shapeType = sh.type === "ellipse" ? pres.ShapeType.ellipse : sh.radius ? pres.ShapeType.roundRect : pres.ShapeType.rect;
    slide.addShape(shapeType, {
      ...box,
      fill: { color: sh.fill, transparency: sh.transparency || 0 },
      line: sh.line ? { color: sh.line, width: 0.75 } : { type: "none" },
      ...(sh.radius ? { rectRadius: sh.radius } : {}),
    });
  } else if (sh.type === "text") {
    slide.addText(sh.text, {
      ...box, margin: 0, fontFace: sh.font, fontSize: sh.size, color: sh.color, bold: !!sh.bold, italic: !!sh.italic,
      align: sh.align || "left", valign: sh.valign || "top", charSpacing: sh.charSpacing || 0,
    });
  } else if (sh.type === "bullets") {
    slide.addText(sh.items.map((b) => ({
      text: b.text,
      options: {
        bullet: { code: b.level ? "2013" : "25CF", indent: Math.round(sh.size * (b.level ? 0.9 : 1.1)) },
        indentLevel: b.level, fontSize: Math.round(sh.size * (b.level ? 0.85 : 1)), color: sh.color,
        paraSpaceAfter: Math.round(sh.size * 0.6), breakLine: true,
      },
    })), { ...box, margin: 0, fontFace: sh.font, color: sh.color, valign: "top" });
  } else if (sh.type === "chart") {
    const { chart } = sh;
    const type = { bar: pres.ChartType.bar, line: pres.ChartType.line, pie: pres.ChartType.pie, doughnut: pres.ChartType.doughnut }[chart.type];
    const round = chart.type === "pie" || chart.type === "doughnut";
    slide.addChart(type, chart.series.map((s) => ({ name: s.name, labels: chart.labels, values: s.values })), {
      ...box,
      chartColors: sh.colors,
      barDir: "col", barGapWidthPct: 60,
      showLegend: round || chart.series.length > 1, legendPos: "b", legendColor: sh.textColor, legendFontFace: sh.font, legendFontSize: 12,
      catAxisLabelColor: sh.textColor, valAxisLabelColor: sh.textColor, catAxisLabelFontFace: sh.font, valAxisLabelFontFace: sh.font,
      catAxisLabelFontSize: 12, valAxisLabelFontSize: 11, catAxisLineShow: false, valAxisLineShow: false,
      valGridLine: { color: sh.gridColor, size: 0.75 }, catGridLine: { style: "none" },
      lineSize: 3, lineDataSymbolSize: 8,
      showPercent: round, showValue: false, dataLabelColor: "FFFFFF", dataLabelFontSize: 12,
      holeSize: 55,
    });
  } else if (sh.type === "table") {
    const cell = (text, opts) => ({ text, options: opts });
    const rows = [];
    if (sh.headers) rows.push(sh.headers.map((h) => cell(h, { bold: true, color: sh.headColor, fill: { color: sh.headFill } })));
    sh.rows.forEach((r, i) => rows.push(r.map((c) => cell(c, { color: sh.color, fill: { color: i % 2 ? sh.altFill : sh.fill } }))));
    slide.addTable(rows, {
      x: sh.x, y: sh.y, w: sh.w, rowH: sh.rowH, fontFace: sh.font, fontSize: sh.size, valign: "middle",
      margin: 0.08, border: { type: "solid", pt: 0.75, color: sh.border }, autoPage: false,
    });
  }
}
