// A course (lib/course.js) laid out as a book, not as a plain document:
// a cover, a contents page with page numbers that link to each chapter, a
// new page and an opener ("CHAPTER 3") for every chapter, a running header,
// page numbers, and code in labelled boxes. The plain exportPdf stays for
// ordinary replies.

import { parseMarkdownBlocks, toPdfText as basePdfText, stripChatPreamble, runsText, safeFileName, exportPdf } from "./documentExport.js";

// Symbols jsPDF's built-in fonts can't draw, as plain text: a folder tree,
// arrows, ticks. Anything else outside them (emoji) is dropped. One such
// character used to send the whole course down the image-per-page export,
// which for 100 pages never finished ("keeps loading").
const BOOK_REPLACEMENTS = {
  "├": "+", "└": "+", "┌": "+", "┐": "+", "┘": "+", "┬": "+", "┴": "+", "┼": "+", "╰": "+", "╭": "+",
  "│": "|", "┃": "|", "─": "-", "━": "-", "═": "=", "║": "|",
  "→": "->", "←": "<-", "↑": "^", "↓": "v", "⇒": "=>", "⇐": "<=", "↔": "<->", "⟶": "->", "➜": "->", "➡": "->",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "×": "x", "÷": "/", "∞": "inf",
  "✅": "[x]", "❌": "[ ]", "⚠": "(!)", "💡": "Tip:", "📁": "", "📄": "",
};
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const drawable = (ch) => {
  const code = ch.codePointAt(0);
  return code === 9 || code === 10 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch);
};

/** `text` in characters the PDF's fonts can draw. */
export function toPdfText(text = "") {
  let out = "";
  for (const ch of basePdfText(text)) {
    if (BOOK_REPLACEMENTS[ch] !== undefined) out += BOOK_REPLACEMENTS[ch];
    else if (drawable(ch)) out += ch;
    // Variation selectors, emoji and other symbols: dropped.
  }
  return out;
}

/**
 * Whether the course is written in a script the built-in fonts can't draw
 * at all (Tamil, Hindi, Chinese…): then only the image-based export can show
 * it. A few stray symbols in an English course don't count.
 */
export function needsImagePdf(text = "") {
  let foreign = 0;
  for (const ch of String(text)) {
    if (/\p{L}/u.test(ch) && !drawable(ch) && !/\p{Script=Greek}/u.test(ch) && ++foreign > 40) return true;
  }
  return false;
}

const ACCENT = [79, 70, 229];
const ACCENT_DARK = [55, 48, 163];
const ACCENT_SOFT = [238, 242, 255];
const INK = [31, 41, 55];
const MUTED = [107, 114, 128];
const RULE = [229, 231, 235];
const CODE_BG = [246, 248, 250];
const CODE_INK = [36, 41, 47];

const CHAPTER = /^chapter\s+(\d+)\s*[:.\-–—]\s*(.+)$/i;

/**
 * The book's parts, from the course Markdown: the title and the lines under
 * it (the cover), the chapters (every ## heading) and the body blocks. The
 * Markdown's own "## Contents" list is dropped: the book draws its own,
 * with page numbers.
 */
export function bookPlan(markdown) {
  const blocks = parseMarkdownBlocks(markdown);
  const titleAt = blocks.findIndex((b) => b.type === "heading" && b.level === 1);
  const title = titleAt >= 0 ? runsText(blocks[titleAt].runs).trim() : "Course";
  const firstH2 = blocks.findIndex((b, i) => i > titleAt && b.type === "heading" && b.level === 2);
  const subtitle = blocks.slice(titleAt + 1, firstH2 < 0 ? blocks.length : firstH2)
    .filter((b) => b.type === "paragraph").map((b) => runsText(b.runs).trim()).filter(Boolean);

  const body = [];
  for (let i = firstH2 < 0 ? blocks.length : firstH2; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "heading" && b.level === 2 && /^contents$/i.test(runsText(b.runs).trim())) {
      // Skip the contents heading and the list under it.
      while (i + 1 < blocks.length && !(blocks[i + 1].type === "heading" && blocks[i + 1].level <= 2)) i++;
      continue;
    }
    body.push(b);
  }
  const chapters = body.filter((b) => b.type === "heading" && b.level === 2).map((b) => {
    const text = runsText(b.runs).trim();
    const m = CHAPTER.exec(text);
    return m ? { number: Number(m[1]), title: m[2].trim(), text } : { number: null, title: text, text };
  });
  return { title, subtitle, chapters, body };
}

/** Downloads the course as a book-style PDF. */
export async function exportBookPdf(markdown) {
  const plan = bookPlan(markdown);
  // Only a course in another script goes through the (slow) image-based
  // export; formulas are written out as text, and stray symbols replaced.
  if (needsImagePdf(stripChatPreamble(markdown))) return exportPdf(markdown, { book: true });

  const { jsPDF } = await import("jspdf");
  // Compressed: a 100-page course was a 16 MB file without it.
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const side = 60;
  const top = 74;
  const bottom = 64;
  const width = W - side * 2;
  const color = (rgb) => pdf.setTextColor(...rgb);
  const font = (weight = "normal", family = "helvetica") => pdf.setFont(family, weight);

  // ── Cover ──────────────────────────────────────────────────────────────
  pdf.setFillColor(...ACCENT);
  pdf.rect(0, 0, W, H * 0.46, "F");
  font("bold"); pdf.setFontSize(10); color([224, 231, 255]);
  pdf.text("VETROAI  ·  COMPLETE COURSE", side, 96, { charSpace: 1.2 });
  font("bold"); pdf.setFontSize(30); color([255, 255, 255]);
  const titleLines = pdf.splitTextToSize(toPdfText(plan.title), width);
  pdf.text(titleLines, side, 160, { lineHeightFactor: 1.15 });
  let coverY = 160 + titleLines.length * 30 * 1.15 + 10;
  font("normal"); pdf.setFontSize(13); color([224, 231, 255]);
  for (const line of plan.subtitle.slice(0, 3)) {
    const wrapped = pdf.splitTextToSize(toPdfText(line.replace(/^\*+|\*+$/g, "")), width);
    pdf.text(wrapped, side, coverY);
    coverY += wrapped.length * 18 + 4;
  }
  font("normal"); pdf.setFontSize(11); color(MUTED);
  pdf.text(`${plan.chapters.length} chapters`, side, H * 0.46 + 48);
  pdf.text(new Date().toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }), side, H - 72);
  font("bold"); color(ACCENT);
  pdf.text("VetroAI", W - side, H - 72, { align: "right" });

  // ── Contents: pages kept for it now, filled in once page numbers are known
  const TOC_PER_PAGE = 24;
  const tocPages = Math.max(1, Math.ceil(plan.chapters.length / TOC_PER_PAGE));
  const firstTocPage = 2;
  for (let i = 0; i < tocPages; i++) pdf.addPage();

  // ── Body ───────────────────────────────────────────────────────────────
  let y = top;
  const chapterOfPage = {};
  let currentChapter = "";
  const chapterPages = [];
  const newPage = () => {
    pdf.addPage();
    y = top;
    chapterOfPage[pdf.getNumberOfPages()] = currentChapter;
  };
  const ensure = (h) => { if (y + h > H - bottom) newPage(); };

  // Styled runs laid out word by word, inline code on a shaded chip.
  const writeRuns = (runs, { size = 10.5, x = side, w = width, lineGap = 1.55, bold = false, ink = INK } = {}) => {
    const lh = size * lineGap;
    const words = [];
    for (const run of runs) {
      const style = bold ? { ...run, bold: true } : run;
      toPdfText(run.text).split(/(\s+)/).forEach((piece) => { if (piece) words.push({ text: piece, style }); });
    }
    const setStyle = (s) => {
      if (s.code) { font("normal", "courier"); pdf.setFontSize(size - 1); return; }
      font(s.bold && s.italic ? "bolditalic" : s.bold ? "bold" : s.italic ? "italic" : "normal");
      pdf.setFontSize(size);
    };
    let line = [];
    let lineW = 0;
    const flush = () => {
      ensure(lh);
      let cx = x;
      for (const word of line) {
        setStyle(word.style);
        const ww = pdf.getTextWidth(word.text);
        // The spaces inside inline code are shaded too, so `node --watch` is
        // one chip rather than two.
        if (word.style.code) {
          pdf.setFillColor(...ACCENT_SOFT);
          pdf.roundedRect(cx - 1.5, y + 1, ww + 3, size + 3, 2, 2, "F");
          color(ACCENT_DARK);
        } else {
          color(word.style.link ? ACCENT : ink);
        }
        pdf.text(word.text, cx, y + size);
        cx += ww;
      }
      y += lh;
      line = [];
      lineW = 0;
    };
    for (const word of words) {
      setStyle(word.style);
      const ww = pdf.getTextWidth(word.text);
      if (/^\s+$/.test(word.text)) { if (line.length) { line.push(word); lineW += ww; } continue; }
      if (lineW + ww > w && line.length) {
        while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
        flush();
      }
      line.push(word);
      lineW += ww;
    }
    if (line.length) flush();
  };

  // Every chapter opens on a fresh page.
  const chapterOpener = (text) => {
    pdf.addPage();
    const m = CHAPTER.exec(text);
    currentChapter = m ? `Chapter ${m[1]}  ·  ${m[2]}` : text;
    const page = pdf.getNumberOfPages();
    chapterOfPage[page] = currentChapter;
    chapterPages.push(page);
    y = 120;
    if (m) {
      font("bold"); pdf.setFontSize(11); color(ACCENT);
      pdf.text(`CHAPTER ${m[1]}`, side, y, { charSpace: 1.5 });
      y += 18;
    }
    font("bold"); pdf.setFontSize(24); color(INK);
    const lines = pdf.splitTextToSize(toPdfText(m ? m[2] : text), width);
    pdf.text(lines, side, y + 20, { lineHeightFactor: 1.2 });
    y += 20 + (lines.length - 1) * 24 * 1.2 + 18;
    pdf.setFillColor(...ACCENT);
    pdf.rect(side, y, 56, 3, "F");
    y += 34;
  };

  for (const block of plan.body) {
    if (block.type === "heading" && block.level === 2) {
      chapterOpener(runsText(block.runs).trim());
    } else if (block.type === "heading") {
      const size = block.level === 3 ? 14 : 12;
      y += block.level === 3 ? 14 : 8;
      ensure(size * 3);
      writeRuns(block.runs, { size, bold: true, lineGap: 1.3, ink: block.level === 3 ? ACCENT_DARK : INK });
      y += 6;
    } else if (block.type === "paragraph") {
      writeRuns(block.runs);
      y += 7;
    } else if (block.type === "list") {
      const counters = [];
      for (const item of block.items) {
        counters[item.level] = (counters[item.level] || 0) + 1;
        counters.length = item.level + 1;
        const indent = side + 16 + item.level * 18;
        ensure(18);
        if (item.ordered) {
          font("bold"); pdf.setFontSize(10.5); color(ACCENT_DARK);
          pdf.text(`${item.number ?? counters[item.level]}.`, indent - 16, y + 10.5);
        } else {
          pdf.setFillColor(...ACCENT);
          pdf.circle(indent - 10, y + 7, 1.8, "F");
        }
        writeRuns(item.runs, { x: indent + 2, w: width - (indent - side) - 2 });
        y += 3;
      }
      y += 6;
    } else if (block.type === "quote") {
      // A note or tip: indented, with an accent bar beside it.
      ensure(36);
      const startPage = pdf.getNumberOfPages();
      const start = y;
      y += 4;
      writeRuns(block.runs, { x: side + 16, w: width - 28, ink: ACCENT_DARK });
      if (pdf.getNumberOfPages() === startPage) {
        pdf.setFillColor(...ACCENT);
        pdf.rect(side, start, 3, y - start, "F");
      }
      y += 10;
    } else if (block.type === "code") {
      font("normal", "courier");
      pdf.setFontSize(9);
      const lines = pdf.splitTextToSize(toPdfText(block.text) || " ", width - 28);
      const lh = 13;
      y += 4;
      if (block.language) {
        ensure(lh * 3);
        font("bold"); pdf.setFontSize(8); color(MUTED);
        pdf.text(block.language.toUpperCase(), side + 2, y + 8, { charSpace: 0.8 });
        y += 13;
      } else {
        ensure(lh * 2);
      }
      // The box is drawn a line at a time, so a long listing simply carries
      // on over the page break.
      const pad = 7;
      lines.forEach((text, i) => {
        const first = i === 0;
        const last = i === lines.length - 1;
        const h = lh + (first ? pad : 0) + (last ? pad : 0);
        ensure(h);
        pdf.setFillColor(...CODE_BG);
        pdf.rect(side, y, width, h, "F");
        pdf.setFillColor(...ACCENT);
        pdf.rect(side, y, 2.5, h, "F");
        font("normal", "courier"); pdf.setFontSize(9); color(CODE_INK);
        pdf.text(text, side + 14, y + (first ? pad : 0) + 9.5);
        y += h;
      });
      y += 12;
    } else if (block.type === "table") {
      const columns = Math.max(block.header.length, ...block.rows.map((r) => r.length));
      const colW = width / columns;
      const drawRow = (cells, header) => {
        font(header ? "bold" : "normal"); pdf.setFontSize(9.5);
        const wrapped = Array.from({ length: columns }, (_, c) => pdf.splitTextToSize(toPdfText(runsText(parseRunsSafe(cells[c]))), colW - 12));
        const h = Math.max(...wrapped.map((l) => l.length)) * 12.5 + 10;
        ensure(h);
        if (header) { pdf.setFillColor(...ACCENT_SOFT); pdf.rect(side, y, width, h, "F"); }
        pdf.setDrawColor(...RULE);
        wrapped.forEach((l, c) => {
          pdf.rect(side + c * colW, y, colW, h);
          color(header ? ACCENT_DARK : INK);
          l.forEach((t, k) => pdf.text(t, side + c * colW + 6, y + 13 + k * 12.5));
        });
        y += h;
      };
      y += 4;
      drawRow(block.header, true);
      block.rows.forEach((r) => drawRow(r, false));
      y += 12;
    } else if (block.type === "rule") {
      ensure(16);
      pdf.setDrawColor(...RULE);
      pdf.line(side, y + 8, W - side, y + 8);
      y += 18;
    } else if (block.type === "math") {
      writeRuns([{ text: block.text, italic: true }]);
      y += 6;
    }
  }

  // ── Running header and page numbers ───────────────────────────────────
  // Header on every body page except a chapter's opening page, which has
  // its own large title; numbers on every page after the cover.
  const pages = pdf.getNumberOfPages();
  for (let p = firstTocPage; p <= pages; p++) {
    pdf.setPage(p);
    if (p >= firstTocPage + tocPages && !chapterPages.includes(p)) {
      font("normal"); pdf.setFontSize(8.5); color(MUTED);
      pdf.text(toPdfText(plan.title).slice(0, 60), side, 40);
      if (chapterOfPage[p]) pdf.text(toPdfText(chapterOfPage[p]).slice(0, 60), W - side, 40, { align: "right" });
      pdf.setDrawColor(...RULE);
      pdf.line(side, 48, W - side, 48);
    }
    font("normal"); pdf.setFontSize(9); color(MUTED);
    pdf.text(String(p), W / 2, H - 30, { align: "center" });
  }

  // ── Contents, with page numbers that link to the chapters ─────────────
  for (let t = 0; t < tocPages; t++) {
    pdf.setPage(firstTocPage + t);
    let ty = top + 20;
    if (t === 0) {
      font("bold"); pdf.setFontSize(24); color(INK);
      pdf.text("Contents", side, ty + 10);
      pdf.setFillColor(...ACCENT);
      pdf.rect(side, ty + 22, 56, 3, "F");
      ty += 56;
    }
    plan.chapters.slice(t * TOC_PER_PAGE, (t + 1) * TOC_PER_PAGE).forEach((c, k) => {
      const i = t * TOC_PER_PAGE + k;
      const page = chapterPages[i];
      font("bold"); pdf.setFontSize(10.5); color(ACCENT);
      pdf.text(c.number ? String(c.number).padStart(2, "0") : "•", side, ty);
      font("normal"); color(INK);
      const name = pdf.splitTextToSize(toPdfText(c.title), width - 70)[0];
      pdf.text(name, side + 30, ty);
      if (page) {
        color(MUTED);
        pdf.text(String(page), W - side, ty, { align: "right" });
        pdf.link(side, ty - 11, width, 15, { pageNumber: page });
      }
      pdf.setDrawColor(...RULE);
      pdf.line(side + 30, ty + 6, W - side, ty + 6);
      ty += 25;
    });
  }

  pdf.save(safeFileName(plan.title, "pdf"));
}

// Table cells as plain text (inline markers stripped).
function parseRunsSafe(cell) {
  return [{ text: String(cell || "").replace(/\*\*|__|`/g, "") }];
}
