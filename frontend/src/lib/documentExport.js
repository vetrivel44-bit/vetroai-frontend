// Turns an assistant reply (Markdown) into real, structured files: PDF, Word
// (.docx) and Excel (.xlsx). The parser is deliberately small and covers what
// models actually write — headings, paragraphs, bullet/numbered lists (nested
// by indentation), GFM tables, block quotes, code fences and rules, with
// bold/italic/code/link runs inside text. The heavy libraries (jsPDF, docx,
// SheetJS) are only loaded when a download is requested.

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
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\$([^$\n]+)\$/g;
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
    else if (match[8] !== undefined) push(match[8], { code: true });
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
  const lines = stripChatPreamble(markdown).split("\n");
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
      blocks.push({ type: "code", language: "math", text: math.join("\n") });
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
const runsHtml = (runs) => runs.map((run) => {
  let html = escapeHtml(run.text);
  if (run.code) html = `<code>${html}</code>`;
  if (run.bold) html = `<strong>${html}</strong>`;
  if (run.italic) html = `<em>${html}</em>`;
  if (run.link) html = `<a href="${escapeHtml(run.link)}">${html}</a>`;
  return html;
}).join("");

function blocksToHtml(blocks) {
  return blocks.map((block) => {
    if (block.type === "heading") return `<h${block.level}>${runsHtml(block.runs)}</h${block.level}>`;
    if (block.type === "paragraph") return `<p>${runsHtml(block.runs)}</p>`;
    if (block.type === "quote") return `<blockquote>${runsHtml(block.runs)}</blockquote>`;
    if (block.type === "code") return `<pre>${escapeHtml(block.text)}</pre>`;
    if (block.type === "rule") return "<hr>";
    if (block.type === "table") {
      const cells = (row, tag) => row.map((cell) => `<${tag}>${runsHtml(parseInline(cell))}</${tag}>`).join("");
      return `<table><thead><tr>${cells(block.header, "th")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody></table>`;
    }
    if (block.type === "list") {
      return block.items.map((item) => {
        const marker = item.ordered ? escapeHtml(item.marker.replace(")", ".")) : ["•", "◦", "▪", "•"][item.level];
        return `<div class="li" style="padding-left:${22 + item.level * 20}px"><span class="mk" style="left:${4 + item.level * 20}px">${marker}</span>${runsHtml(item.runs)}</div>`;
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
  .vetro-pdf-page a { color: #1a56a0; }`;

// Renders the document as styled HTML and captures it page by page, breaking
// between blocks so no line is cut in half.
async function exportPdfAsImages(markdown, filename) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;";
  host.innerHTML = `<style>${IMAGE_PDF_CSS}</style><div class="vetro-pdf-page">${blocksToHtml(parseMarkdownBlocks(markdown))}</div>`;
  document.body.appendChild(host);
  try {
    const pageEl = host.querySelector(".vetro-pdf-page");
    const pageHeightPx = Math.floor(794 * (842 / 595)) - 112;
    const breaks = [0];
    let pageStart = 0;
    for (const child of pageEl.children) {
      const top = child.offsetTop - 56;
      const bottom = top + child.offsetHeight;
      if (bottom - pageStart > pageHeightPx && top > pageStart) { breaks.push(top); pageStart = top; }
    }
    const scale = 2;
    const canvas = await html2canvas(pageEl, { scale, backgroundColor: "#ffffff", logging: false });
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const ptPerPx = 595 / 794;
    breaks.forEach((start, index) => {
      const end = index + 1 < breaks.length ? breaks[index + 1] : pageEl.offsetHeight - 112;
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.max(1, Math.round((end - start + 112) * scale));
      const ctx = slice.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      // Top padding + this page's content band (+ bottom padding of white).
      ctx.drawImage(canvas, 0, 0, canvas.width, 56 * scale, 0, 0, canvas.width, 56 * scale);
      ctx.drawImage(canvas, 0, (start + 56) * scale, canvas.width, (end - start) * scale, 0, 56 * scale, canvas.width, (end - start) * scale);
      if (index > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 595, slice.height / scale * ptPerPx);
    });
    pdf.save(filename);
  } finally {
    host.remove();
  }
}

export async function exportPdf(markdown) {
  const filename = safeFileName(documentTitle(markdown), "pdf");
  if (!isPdfSafe(toPdfText(stripChatPreamble(markdown)))) return exportPdfAsImages(markdown, filename);
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
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ExternalHyperlink, BorderStyle, ShadingType } = docx;

  const toRuns = (runs, extra = {}) => runs.map((run) => {
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
  for (const block of parseMarkdownBlocks(markdown)) {
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

  const document = new Document({
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
  const blob = await Packer.toBlob(document);
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
    else if (block.runs) lines.push([runsText(block.runs)]);
  }
  return [lines];
}

const numeric = (value) => (/^-?\d+(\.\d+)?$/.test(String(value).replace(/,/g, "")) ? Number(String(value).replace(/,/g, "")) : value);

export async function exportXlsx(markdown) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error("The spreadsheet library didn't load. Refresh the page and try again.");
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
