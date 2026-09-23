// Turns an assistant reply (Markdown) into real, structured files: PDF, Word
// (.docx) and Excel (.xlsx). The parser is deliberately small and covers what
// models actually write — headings, paragraphs, bullet/numbered lists (nested
// by indentation), GFM tables, block quotes, code fences and rules, with
// bold/italic/code/link runs inside text. The heavy libraries (jsPDF, docx,
// SheetJS) are only loaded when a download is requested.

import { normalizeMathDelimiters, latexToText } from "./math.js";

const FORMAT_PATTERNS = [
  ["pdf", /\bpdf\b/i],
  ["docx", /\b(word|docx?|ms ?word)\b/i],
  ["xlsx", /\b(excel|xlsx?|spreadsheet|sheet)\b/i],
  ["csv", /\bcsv\b/i],
];
const FILE_VERBS = /\b(download|export|save|give|provide|create|make|generate|send|convert|prepare)\b/i;
const FORMAT_PHRASE = /\b(as|in|into|to)\s+(an?\s+)?(pdf|word|docx?|excel|xlsx|csv|spreadsheet)\b/i;

// Formats the user asked for, e.g. "give this as a PDF" -> ["pdf"].
export function requestedFileFormats(text = "") {
  const value = String(text);
  if (!FILE_VERBS.test(value) && !FORMAT_PHRASE.test(value)) return [];
  return FORMAT_PATTERNS.filter(([, rx]) => rx.test(value)).map(([format]) => format);
}

const FORMAT_LABELS = { pdf: "PDF", docx: "Word", xlsx: "Excel", csv: "CSV" };

// Extra instruction sent with a turn that asks for a file, so the model writes
// the document itself instead of saying it can't attach files.
export function fileRequestInstruction(formats = []) {
  if (!formats.length) return "";
  const names = formats.map((f) => FORMAT_LABELS[f] || f.toUpperCase()).join(" / ");
  const wantsSheet = formats.some((f) => f === "xlsx" || f === "csv");
  return [
    `[FILE REQUEST] The user wants this as a downloadable ${names} file. VetroAI converts your reply into that file automatically and shows download buttons under it, so never say you cannot create, attach or send files.`,
    "Reply with the complete document itself, written in clean Markdown: a single # title, ## section headings, short paragraphs, bullet or numbered lists, and **bold** for key terms.",
    wantsSheet
      ? "Put all tabular data in Markdown tables (header row + separator row) — each table becomes a sheet with real columns."
      : "Use Markdown tables for any tabular data.",
    "Do not wrap the document in a code block, and keep any chat before it to one short line.",
  ].join(" ");
}

// ── Markdown → blocks ─────────────────────────────────────────────────────────

// Inline Markdown → [{ text, bold, italic, code, link }]
export function parseInline(text = "") {
  const runs = [];
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\$\$([^$\n]+)\$\$|\$(?=\S)([^$\n]*?\S)\$(?!\d)/g;
  let last = 0;
  let match;
  const push = (value, style = {}) => { if (value) runs.push({ text: value, ...style }); };
  while ((match = pattern.exec(text))) {
    push(text.slice(last, match.index));
    if (match[2] !== undefined) {
      for (const inner of parseInline(match[2])) runs.push({ ...inner, bold: true });
    } else if (match[4] !== undefined) {
      for (const inner of parseInline(match[4])) runs.push({ ...inner, italic: true });
    } else if (match[5] !== undefined) push(match[5], { code: true });
    else if (match[6] !== undefined) push(match[6], { link: match[7] });
    else if (match[8] !== undefined || match[9] !== undefined) {
      const latex = (match[8] ?? match[9]).trim();
      runs.push({ text: latexToText(latex), math: latex });
    }
    last = pattern.lastIndex;
  }
  push(text.slice(last));
  return runs.length ? runs : [{ text: "" }];
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const splitRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

// A reply often opens with a line of chat ("Here are your notes:") before the
// document's own # title; that line doesn't belong in the file.
export function stripChatPreamble(markdown = "") {
  const text = String(markdown).replace(/\r/g, "");
  const match = /^#\s+\S/m.exec(text);
  if (!match || match.index === 0) return text;
  const before = text.slice(0, match.index).trim();
  return before.split("\n").length <= 2 && before.length <= 200 ? text.slice(match.index) : text;
}

export function parseMarkdownBlocks(markdown = "") {
  const lines = normalizeMathDelimiters(stripChatPreamble(markdown)).split("\n");
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", runs: parseInline(paragraph.join(" ").trim()) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flushParagraph(); continue; }

    const fence = trimmed.match(/^(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      flushParagraph();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      blocks.push({ type: "code", language: fence[2] || "", text: code.join("\n") });
      continue;
    }

    if (trimmed === "$$") {
      flushParagraph();
      const math = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") math.push(lines[i++]);
      const latex = math.join("\n").trim();
      blocks.push({ type: "math", latex, text: latexToText(latex) });
      continue;
    }

    const displayMath = trimmed.match(/^\$\$(.+)\$\$$/);
    if (displayMath) {
      flushParagraph();
      blocks.push({ type: "math", latex: displayMath[1].trim(), text: latexToText(displayMath[1].trim()) });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, runs: parseInline(heading[2]) });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushParagraph(); blocks.push({ type: "rule" }); continue; }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));
      i--;
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) quote.push(lines[i++].trim().replace(/^>\s?/, ""));
      i--;
      blocks.push({ type: "quote", runs: parseInline(quote.join(" ")) });
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      flushParagraph();
      const items = [];
      // Indents seen so far, outermost first: a deeper indent opens one more
      // level whatever its width (2 spaces under "-", 3 under "1.").
      const indents = [item[1].replace(/\t/g, "    ").length];
      while (i < lines.length) {
        const current = lines[i].match(LIST_ITEM);
        if (current) {
          const indent = current[1].replace(/\t/g, "    ").length;
          if (indent > indents[indents.length - 1]) indents.push(indent);
          else while (indents.length > 1 && indent < indents[indents.length - 1]) indents.pop();
          items.push({
            level: Math.min(3, indents.length - 1),
            ordered: /\d/.test(current[2]),
            marker: current[2],
            runs: parseInline(current[3]),
          });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          const previous = items[items.length - 1];
          previous.runs = [...previous.runs, { text: " " }, ...parseInline(lines[i].trim())];
          i++;
        } else break;
      }
      i--;
      blocks.push({ type: "list", items });
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

const runsText = (runs = []) => runs.map((run) => run.text).join("");

export function documentTitle(markdown = "", fallback = "VetroAI document") {
  const heading = parseMarkdownBlocks(markdown).find((block) => block.type === "heading");
  return (heading ? runsText(heading.runs) : fallback).slice(0, 80) || fallback;
}

const safeFileName = (title, ext) =>
  `${String(title).replace(/[^\p{L}\p{M}\p{N}_ -]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "vetroai-document"}.${ext}`;

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

// jsPDF's built-in fonts only cover WinAnsi (Latin-1 plus a few symbols).
// Common symbols are mapped to lookalikes; anything else (Tamil, Hindi, CJK,
// emoji…) sends the export down the image-based path, which the browser
// renders with its own fonts.
const PDF_REPLACEMENTS = {
  "→": "->", "←": "<-", "⇒": "=>", "⇐": "<=", "↔": "<->", "⟶": "->", "➜": "->", "➔": "->",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "∞": "infinity", "√": "sqrt", "∑": "sum", "∆": "delta", "Δ": "Delta",
  "−": "-", "‐": "-", "‑": "-", "′": "'", "″": "\"", "…": "...", "\u00a0": " ", "\u200b": "",
  "◦": "-", "▪": "-", "▫": "-", "●": "•", "○": "-", "■": "-", "□": "-", "✓": "v", "✔": "v", "✗": "x", "✘": "x", "★": "*", "☆": "*",
  "π": "pi", "μ": "mu", "σ": "sigma", "α": "alpha", "β": "beta", "γ": "gamma", "θ": "theta", "λ": "lambda", "Ω": "Omega", "ω": "omega",
};
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

export function toPdfText(text = "") {
  let out = "";
  for (const ch of String(text)) {
    if (PDF_REPLACEMENTS[ch] !== undefined) out += PDF_REPLACEMENTS[ch];
    else if (SUBSCRIPTS.includes(ch)) out += SUBSCRIPTS.indexOf(ch);
    else if (SUPERSCRIPTS.includes(ch) && !"¹²³".includes(ch)) out += `^${SUPERSCRIPTS.indexOf(ch)}`;
    else out += ch;
  }
  return out;
}

export function isPdfSafe(text = "") {
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code === 10 || code === 9) continue;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) continue;
    return false;
  }
  return true;
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const renderMath = (katex, latex, displayMode) =>
  katex.renderToString(latex, { displayMode, throwOnError: false, strict: false, output: "html" });

const runsHtml = (runs, katex) => runs.map((run) => {
  if (run.math && katex) return renderMath(katex, run.math, false);
  let html = escapeHtml(run.text);
  if (run.code) html = `<code>${html}</code>`;
  if (run.bold) html = `<strong>${html}</strong>`;
  if (run.italic) html = `<em>${html}</em>`;
  if (run.link) html = `<a href="${escapeHtml(run.link)}">${html}</a>`;
  return html;
}).join("");

function blocksToHtml(blocks, katex) {
  const runsHtml_ = (runs) => runsHtml(runs, katex);
  return blocks.map((block) => {
    if (block.type === "heading") return `<h${block.level}>${runsHtml_(block.runs)}</h${block.level}>`;
    if (block.type === "paragraph") return `<p>${runsHtml_(block.runs)}</p>`;
    if (block.type === "quote") return `<blockquote>${runsHtml_(block.runs)}</blockquote>`;
    if (block.type === "code") return `<pre>${escapeHtml(block.text)}</pre>`;
    if (block.type === "math") return `<div class="math-block">${katex ? renderMath(katex, block.latex, true) : escapeHtml(block.text)}</div>`;
    if (block.type === "rule") return "<hr>";
    if (block.type === "table") {
      const cells = (row, tag) => row.map((cell) => `<${tag}>${runsHtml_(parseInline(cell))}</${tag}>`).join("");
      return `<table><thead><tr>${cells(block.header, "th")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody></table>`;
    }
    if (block.type === "list") {
      return block.items.map((item) => {
        const marker = item.ordered ? escapeHtml(item.marker.replace(")", ".")) : ["•", "◦", "▪", "•"][item.level];
        return `<div class="li" style="padding-left:${22 + item.level * 20}px"><span class="mk" style="left:${4 + item.level * 20}px">${marker}</span>${runsHtml_(item.runs)}</div>`;
      }).join("");
    }
    return "";
  }).join("");
}

const IMAGE_PDF_CSS = `
  .vetro-pdf-page { box-sizing: border-box; width: 794px; padding: 56px 60px; background: #fff; color: #1e1e1e;
    font: 15px/1.6 "Noto Sans", "Nirmala UI", "Segoe UI", system-ui, sans-serif; }
  .vetro-pdf-page > * { margin: 0 0 10px; }
  .vetro-pdf-page h1 { font-size: 26px; line-height: 1.3; border-bottom: 1px solid #ccc; padding-bottom: 6px; margin: 4px 0 14px; }
  .vetro-pdf-page h2 { font-size: 20px; margin-top: 18px; } .vetro-pdf-page h3 { font-size: 17px; margin-top: 14px; }
  .vetro-pdf-page h4, .vetro-pdf-page h5, .vetro-pdf-page h6 { font-size: 15px; }
  .vetro-pdf-page .li { position: relative; margin: 0 0 4px; } .vetro-pdf-page .mk { position: absolute; }
  .vetro-pdf-page blockquote { border-left: 3px solid #bbb; padding-left: 12px; color: #555; }
  .vetro-pdf-page pre { background: #f4f4f2; padding: 10px 12px; border-radius: 6px; font: 13px/1.5 monospace; white-space: pre-wrap; }
  .vetro-pdf-page code { font-family: monospace; background: #f4f4f2; padding: 0 3px; }
  .vetro-pdf-page table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  .vetro-pdf-page th, .vetro-pdf-page td { border: 1px solid #c8c8cd; padding: 6px 8px; text-align: left; vertical-align: top; }
  .vetro-pdf-page th { background: #ececf0; } .vetro-pdf-page hr { border: 0; border-top: 1px solid #d2d2d2; }
  .vetro-pdf-page a { color: #1a56a0; }
  .vetro-pdf-page h1, .vetro-pdf-page h2, .vetro-pdf-page h3, .vetro-pdf-page h4, .vetro-pdf-page h5, .vetro-pdf-page h6,
  .vetro-pdf-page strong, .vetro-pdf-page th { font-weight: 700; }
  .vetro-pdf-page em { font-style: italic; }
  .vetro-pdf-page .math-block { text-align: center; margin: 6px 0 12px; overflow: hidden; }
  .vetro-pdf-page .katex { font-size: 1.08em; }
  .vetro-pdf-page .math-block .katex-display { margin: 0; }`;

const A4 = { widthPx: 794, heightPx: 1123, widthPt: 595.28, heightPt: 841.89 };
const PAGE_PADDING_PX = 56;

// Renders the document as styled HTML (formulas laid out by KaTeX, text in the
// browser's own fonts) and captures it one A4 page at a time with
// html-to-image, which lets the browser do the layout — so fractions, roots
// and scripts come out exactly as on screen. Pages break between blocks.
async function exportPdfAsImages(markdown, filename) {
  const [{ jsPDF }, htmlToImage, { default: katex }] = await Promise.all([import("jspdf"), import("html-to-image"), import("katex")]);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;";
  host.innerHTML = `<style>${IMAGE_PDF_CSS}</style><div class="vetro-pdf-page">${blocksToHtml(parseMarkdownBlocks(markdown), katex)}</div>`;
  document.body.appendChild(host);
  try {
    await document.fonts?.ready;
    const flow = host.querySelector(".vetro-pdf-page");
    const contentHeight = A4.heightPx - PAGE_PADDING_PX * 2;
    const groups = [];
    let pageTop = 0;
    for (const child of [...flow.children]) {
      const top = child.offsetTop;
      const bottom = top + child.offsetHeight;
      if (!groups.length || (bottom - pageTop > contentHeight && groups[groups.length - 1].length)) {
        groups.push([]);
        pageTop = top;
      }
      groups[groups.length - 1].push(child);
    }
    const pages = groups.map((children) => {
      const page = document.createElement("div");
      page.className = "vetro-pdf-page";
      children.forEach((child) => page.appendChild(child));
      host.appendChild(page);
      page.style.minHeight = `${A4.heightPx}px`;
      return page;
    });
    flow.remove();

    const fontEmbedCSS = await htmlToImage.getFontEmbedCSS(host).catch(() => undefined);
    let pdf = null;
    for (const page of pages) {
      // A single block taller than a page (a long table) gets a taller page
      // rather than being cut off.
      const heightPx = Math.max(A4.heightPx, page.offsetHeight);
      const canvas = await htmlToImage.toCanvas(page, { pixelRatio: 2, backgroundColor: "#ffffff", width: A4.widthPx, height: heightPx, fontEmbedCSS });
      const heightPt = (heightPx / A4.widthPx) * A4.widthPt;
      const format = [A4.widthPt, heightPt];
      if (!pdf) pdf = new jsPDF({ unit: "pt", format });
      else pdf.addPage(format);
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, A4.widthPt, heightPt);
    }
    pdf.save(filename);
  } finally {
    host.remove();
  }
}

const runsHaveMath = (runs = []) => runs.some((run) => run.math);
export function hasMath(blocks) {
  return blocks.some((block) =>
    block.type === "math"
    || runsHaveMath(block.runs)
    || (block.items || []).some((item) => runsHaveMath(item.runs))
    || (block.type === "table" && [block.header, ...block.rows].some((row) => row.some((cell) => runsHaveMath(parseInline(cell))))));
}

// Renders one formula with KaTeX and captures it as a PNG, sized in CSS px.
async function mathImage(katex, htmlToImage, latex, displayMode, fontEmbedCSS) {
  // The off-screen positioning lives on the wrapper; the captured element
  // itself must not carry it, or html-to-image draws it off-canvas.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;";
  // nowrap: KaTeX allows line breaks after = and operators, which would wrap
  // the formula inside its tight capture box and cut the second line off.
  host.innerHTML = `<div style="display:inline-block;white-space:nowrap;background:#fff;color:#1e1e1e;font-size:15px;padding:2px 3px;">${renderMath(katex, latex, displayMode)}</div>`;
  const target = host.firstElementChild;
  const display = host.querySelector(".katex-display");
  if (display) display.style.margin = "0";
  document.body.appendChild(host);
  try {
    await document.fonts?.ready;
    const rect = target.getBoundingClientRect();
    const width = Math.ceil(rect.width) + 2;
    const height = Math.ceil(rect.height) + 2;
    const canvas = await htmlToImage.toCanvas(target, { pixelRatio: 3, backgroundColor: "#ffffff", width, height, fontEmbedCSS });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    host.remove();
  }
}

export async function exportPdf(markdown) {
  const filename = safeFileName(documentTitle(markdown), "pdf");
  // Formulas need KaTeX's layout, and other scripts need the browser's fonts;
  // both go through the image path.
  if (hasMath(parseMarkdownBlocks(markdown)) || !isPdfSafe(toPdfText(stripChatPreamble(markdown)))) {
    return exportPdfAsImages(markdown, filename);
  }
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const page = { width: pdf.internal.pageSize.getWidth(), height: pdf.internal.pageSize.getHeight() };
  const margin = 52;
  const maxWidth = page.width - margin * 2;
  let y = margin;

  const ensureSpace = (height) => {
    if (y + height > page.height - margin) { pdf.addPage(); y = margin; }
  };
  const fontFor = (run) => {
    if (run.code) return ["courier", "normal"];
    if (run.bold && run.italic) return ["helvetica", "bolditalic"];
    if (run.bold) return ["helvetica", "bold"];
    if (run.italic) return ["helvetica", "italic"];
    return ["helvetica", "normal"];
  };

  // Lays out styled runs word by word so bold/italic survive line wrapping.
  const writeRuns = (runs, { size = 11, x = margin, width = maxWidth, lineGap = 1.45, forceBold = false, color = [30, 30, 30] } = {}) => {
    const lineHeight = size * lineGap;
    const words = [];
    for (const run of runs) {
      const style = forceBold ? { ...run, bold: true } : run;
      toPdfText(run.text).split(/(\s+)/).forEach((piece) => { if (piece) words.push({ text: piece, style }); });
    }
    pdf.setFontSize(size);
    let line = [];
    let lineWidth = 0;
    const flush = () => {
      ensureSpace(lineHeight);
      let cursor = x;
      for (const word of line) {
        const [family, weight] = fontFor(word.style);
        pdf.setFont(family, weight);
        pdf.setTextColor(...(word.style.link ? [26, 86, 160] : color));
        pdf.text(word.text, cursor, y + size);
        cursor += pdf.getTextWidth(word.text);
      }
      y += lineHeight;
      line = [];
      lineWidth = 0;
    };
    for (const word of words) {
      const [family, weight] = fontFor(word.style);
      pdf.setFont(family, weight);
      const wordWidth = pdf.getTextWidth(word.text);
      if (/^\s+$/.test(word.text)) {
        if (line.length) { line.push(word); lineWidth += wordWidth; }
        continue;
      }
      if (lineWidth + wordWidth > width && line.length) {
        while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
        flush();
      }
      line.push(word);
      lineWidth += wordWidth;
    }
    if (line.length) flush();
    pdf.setTextColor(30, 30, 30);
  };

  const headingSizes = { 1: 20, 2: 16, 3: 13.5, 4: 12, 5: 11.5, 6: 11 };
  const blocks = parseMarkdownBlocks(markdown);

  for (const block of blocks) {
    if (block.type === "heading") {
      y += block.level <= 2 ? 10 : 6;
      ensureSpace(headingSizes[block.level] * 2);
      writeRuns(block.runs, { size: headingSizes[block.level], forceBold: true, lineGap: 1.3 });
      if (block.level === 1) {
        pdf.setDrawColor(200, 200, 200);
        pdf.line(margin, y + 2, page.width - margin, y + 2);
        y += 8;
      }
      y += 4;
    } else if (block.type === "paragraph") {
      writeRuns(block.runs);
      y += 6;
    } else if (block.type === "list") {
      const counters = [];
      for (const item of block.items) {
        counters[item.level] = (counters[item.level] || 0) + 1;
        counters.length = item.level + 1;
        const indent = margin + 14 + item.level * 18;
        const bullet = item.ordered ? `${counters[item.level]}.` : ["•", "-", "·", "•"][item.level];
        ensureSpace(16);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(11);
        pdf.text(bullet, indent - 12, y + 11);
        writeRuns(item.runs, { x: indent + 4, width: maxWidth - (indent - margin) - 4 });
        y += 2;
      }
      y += 6;
    } else if (block.type === "quote") {
      const start = y;
      writeRuns(block.runs, { x: margin + 14, width: maxWidth - 14, color: [80, 80, 80] });
      pdf.setDrawColor(180, 180, 180);
      pdf.setLineWidth(2);
      pdf.line(margin + 4, start + 2, margin + 4, y - 2);
      pdf.setLineWidth(0.5);
      y += 6;
    } else if (block.type === "code") {
      pdf.setFont("courier", "normal");
      pdf.setFontSize(9.5);
      const lines = pdf.splitTextToSize(toPdfText(block.text) || " ", maxWidth - 16);
      for (const text of lines) {
        ensureSpace(14);
        pdf.setFillColor(244, 244, 242);
        pdf.rect(margin, y, maxWidth, 14, "F");
        pdf.setTextColor(40, 40, 40);
        pdf.text(text, margin + 8, y + 10);
        y += 14;
      }
      pdf.setTextColor(30, 30, 30);
      y += 8;
    } else if (block.type === "rule") {
      ensureSpace(12);
      pdf.setDrawColor(210, 210, 210);
      pdf.line(margin, y + 6, page.width - margin, y + 6);
      y += 14;
    } else if (block.type === "table") {
      const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length));
      const colWidth = maxWidth / columns;
      const drawRow = (cells, header) => {
        pdf.setFontSize(9.5);
        pdf.setFont("helvetica", header ? "bold" : "normal");
        const wrapped = Array.from({ length: columns }, (_, c) =>
          pdf.splitTextToSize(toPdfText(runsText(parseInline(cells[c] || ""))), colWidth - 10));
        const height = Math.max(...wrapped.map((lines) => lines.length)) * 12 + 8;
        ensureSpace(height);
        if (header) { pdf.setFillColor(236, 236, 240); pdf.rect(margin, y, maxWidth, height, "F"); }
        pdf.setDrawColor(200, 200, 205);
        wrapped.forEach((lines, c) => {
          pdf.rect(margin + c * colWidth, y, colWidth, height);
          lines.forEach((text, l) => pdf.text(text, margin + c * colWidth + 5, y + 12 + l * 12));
        });
        y += height;
      };
      drawRow(block.header, true);
      block.rows.forEach((row) => drawRow(row, false));
      y += 10;
    }
  }

  pdf.save(filename);
}

// ── Word (.docx) ──────────────────────────────────────────────────────────────

export async function exportDocx(markdown) {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, HeadingLevel, Table, TableRow, TableCell, WidthType, ExternalHyperlink, BorderStyle, ShadingType } = docx;
  const blocks = parseMarkdownBlocks(markdown);

  // Word has no LaTeX: each formula is drawn once with KaTeX and inserted as
  // a crisp image, inline at text size or centred on its own line.
  const mathImages = new Map();
  if (hasMath(blocks)) {
    const [{ default: katex }, htmlToImage] = await Promise.all([import("katex"), import("html-to-image")]);
    // Embed KaTeX's fonts once and reuse them for every formula.
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:-10000px;top:0;";
    // Uses every KaTeX font face (sizes for tall delimiters, bold, script…),
    // since only fonts present in the probe get embedded.
    probe.innerHTML = renderMath(katex, String.raw`\binom{n}{k}\Bigg(\bigg(\Big(\left(\dfrac{a}{b}\right)\Big)\bigg)\Bigg)\sqrt{x}\int\sum\prod\mathbf{A}\mathit{a}\text{t}\textbf{b}\mathcal{L}\mathbb{R}\mathfrak{g}\mathsf{S}\mathscr{F}\mathtt{x}\boldsymbol{\alpha}`, true);
    document.body.appendChild(probe);
    await document.fonts?.ready;
    const fontEmbedCSS = await htmlToImage.getFontEmbedCSS(probe).catch(() => undefined);
    probe.remove();
    const wanted = [];
    const collect = (runs = []) => runs.forEach((run) => { if (run.math) wanted.push([run.math, false]); });
    for (const block of blocks) {
      if (block.type === "math") wanted.push([block.latex, true]);
      collect(block.runs);
      (block.items || []).forEach((item) => collect(item.runs));
      if (block.type === "table") [block.header, ...block.rows].forEach((row) => row.forEach((cell) => collect(parseInline(cell))));
    }
    for (const [latex, display] of wanted) {
      const key = `${display ? "D" : "I"}:${latex}`;
      if (!mathImages.has(key)) {
        try { mathImages.set(key, await mathImage(katex, htmlToImage, latex, display, fontEmbedCSS)); } catch { /* falls back to text */ }
      }
    }
  }
  const mathRun = (latex, display) => {
    const image = mathImages.get(`${display ? "D" : "I"}:${latex}`);
    return image ? new ImageRun({ type: "png", data: image.data, transformation: { width: image.width, height: image.height } }) : null;
  };

  const toRuns = (runs, extra = {}) => runs.map((run) => {
    if (run.math) {
      const image = mathRun(run.math, false);
      if (image) return image;
    }
    const text = new TextRun({
      text: run.text,
      bold: run.bold || extra.bold,
      italics: run.italic,
      font: run.code ? "Consolas" : undefined,
      color: run.link ? "1A56A0" : extra.color,
      underline: run.link ? {} : undefined,
    });
    return run.link ? new ExternalHyperlink({ link: run.link, children: [text] }) : text;
  });
  const headingLevels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  const children = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({ heading: block.level === 1 ? HeadingLevel.TITLE : headingLevels[block.level - 1], children: toRuns(block.runs) }));
    } else if (block.type === "paragraph") {
      children.push(new Paragraph({ children: toRuns(block.runs), spacing: { after: 120 } }));
    } else if (block.type === "list") {
      for (const item of block.items) {
        children.push(new Paragraph({
          children: toRuns(item.runs),
          ...(item.ordered
            ? { numbering: { reference: "vetro-numbered", level: item.level } }
            : { bullet: { level: item.level } }),
        }));
      }
    } else if (block.type === "quote") {
      children.push(new Paragraph({
        children: toRuns(block.runs, { color: "555555" }),
        indent: { left: 400 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 8 } },
      }));
    } else if (block.type === "code") {
      for (const line of (block.text || "").split("\n")) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line || " ", font: "Consolas", size: 19 })],
          shading: { type: ShadingType.CLEAR, fill: "F4F4F2", color: "auto" },
          spacing: { after: 0 },
        }));
      }
      children.push(new Paragraph({ children: [] }));
    } else if (block.type === "math") {
      const image = mathRun(block.latex, true);
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 160 },
        children: [image || new TextRun({ text: block.text, italics: true })],
      }));
    } else if (block.type === "rule") {
      children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, children: [] }));
    } else if (block.type === "table") {
      const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length));
      const makeRow = (cells, header) => new TableRow({
        ...(header ? { tableHeader: true } : {}),
        children: Array.from({ length: columns }, (_, c) => new TableCell({
          children: [new Paragraph({ children: toRuns(parseInline(cells[c] || ""), { bold: header }) })],
          shading: header ? { type: ShadingType.CLEAR, fill: "ECECF0", color: "auto" } : undefined,
        })),
      });
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [makeRow(block.header, true), ...block.rows.map((row) => makeRow(row, false))],
      }));
      children.push(new Paragraph({ children: [] }));
    }
  }

  const wordDocument = new Document({
    creator: "VetroAI",
    title: documentTitle(markdown),
    numbering: {
      config: [{
        reference: "vetro-numbered",
        levels: [0, 1, 2, 3].map((level) => ({
          level,
          format: ["decimal", "lowerLetter", "lowerRoman", "decimal"][level],
          text: `%${level + 1}.`,
          alignment: "left",
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [new TextRun(markdown)] })] }],
  });
  const blob = await Packer.toBlob(wordDocument);
  saveBlob(blob, safeFileName(documentTitle(markdown), "docx"));
}

// ── Excel (.xlsx) / CSV ───────────────────────────────────────────────────────

// Every Markdown table becomes a sheet with real columns; a reply with no
// table falls back to one row per line so nothing is lost.
export function spreadsheetTables(markdown = "") {
  const blocks = parseMarkdownBlocks(markdown);
  const tables = blocks.filter((block) => block.type === "table")
    .map((block) => [block.header, ...block.rows].map((row) => row.map((cell) => runsText(parseInline(cell)))));
  if (tables.length) return tables;
  const lines = [];
  for (const block of blocks) {
    if (block.type === "list") block.items.forEach((item) => lines.push([runsText(item.runs)]));
    else if (block.type === "code") block.text.split("\n").forEach((line) => lines.push([line]));
    else if (block.type === "math") lines.push([block.text]);
    else if (block.runs) lines.push([runsText(block.runs)]);
  }
  return [lines];
}

const numeric = (value) => (/^-?\d+(\.\d+)?$/.test(String(value).replace(/,/g, "")) ? Number(String(value).replace(/,/g, "")) : value);

// SheetJS is ~1 MB, so it's fetched the first time someone exports a
// spreadsheet rather than with the app.
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxLoading ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = XLSX_URL;
    script.async = true;
    script.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("The spreadsheet library didn't load.")));
    script.onerror = () => {
      xlsxLoading = null;
      script.remove();
      reject(new Error("The spreadsheet library didn't load. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return xlsxLoading;
}

export async function exportXlsx(markdown) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  spreadsheetTables(markdown).forEach((rows, index) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows.map((row, r) => (r === 0 ? row : row.map(numeric))));
    const widths = rows[0]?.map((_, c) => ({ wch: Math.min(60, Math.max(10, ...rows.map((row) => String(row[c] ?? "").length + 2))) }));
    if (widths) sheet["!cols"] = widths;
    XLSX.utils.book_append_sheet(workbook, sheet, `Sheet${index + 1}`);
  });
  XLSX.writeFile(workbook, safeFileName(documentTitle(markdown), "xlsx"));
}

export function exportCsv(markdown) {
  const [rows] = spreadsheetTables(markdown);
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  saveBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), safeFileName(documentTitle(markdown), "csv"));
}

export function exportDocument(format, markdown) {
  if (format === "pdf") return exportPdf(markdown);
  if (format === "docx") return exportDocx(markdown);
  if (format === "xlsx") return exportXlsx(markdown);
  if (format === "csv") return exportCsv(markdown);
  throw new Error(`Unsupported format: ${format}`);
}
