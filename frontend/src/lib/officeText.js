import JSZip from "jszip";

// Text from Office files, read in the browser so every model can answer about
// them. .docx, .pptx and .xlsx are zip archives of XML; their text is pulled
// out with a few patterns (no DOM needed, so the same code runs in tests).
// Old binary .doc/.ppt/.xls files can't be read this way — see officeKind.

export const OFFICE_TEXT_LIMIT = 20000;

const EXT_KIND = { docx: "word", pptx: "powerpoint", xlsx: "excel", doc: "legacy", ppt: "legacy", xls: "legacy" };

// "word" | "powerpoint" | "excel" | "legacy" | null
export function officeKind(name = "") {
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return EXT_KIND[ext] || null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
export function decodeXml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const tidy = (s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const byNumber = (a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/)?.[1] || 0);

// word/document.xml → paragraphs, with table rows as "cell | cell".
export function wordXmlToText(xml) {
  let out = "";
  let cellDepth = 0;
  const rx = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:tc[\s>]|<\/w:tc>|<\/w:tr>|<\/w:p>/g;
  for (const m of String(xml).matchAll(rx)) {
    const tag = m[0];
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (tag === "<w:tab/>") out += "\t";
    else if (tag === "<w:br/>") out += "\n";
    else if (tag.startsWith("<w:tc")) cellDepth++;
    else if (tag === "</w:tc>") { cellDepth = Math.max(0, cellDepth - 1); out = out.replace(/\s+$/, "") + " | "; }
    else if (tag === "</w:tr>") out = out.replace(/\s*\|\s*$/, "") + "\n";
    else if (tag === "</w:p>") out += cellDepth ? " " : "\n";
  }
  return tidy(out);
}

// One slide's (or notes page's) XML → its lines of text.
export function drawingXmlToText(xml) {
  let out = "";
  const rx = /<a:t>([^<]*)<\/a:t>|<a:br\/>|<\/a:p>/g;
  for (const m of String(xml).matchAll(rx)) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else out += "\n";
  }
  return tidy(out);
}

// "B12" → 1 (0-based column index)
function columnIndex(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/)?.[0] || "A";
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

export function sharedStrings(xml) {
  return [...String(xml || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decodeXml(t[1])).join(""));
}

// One worksheet's XML → rows of cells joined with " | ".
export function sheetXmlToRows(xml, strings = [], maxRows = 400) {
  const rows = [];
  for (const row of String(xml).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] || "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      let value = "";
      if (type === "inlineStr") value = [...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decodeXml(t[1])).join("");
      else {
        const v = body.match(/<v>([^<]*)<\/v>/)?.[1];
        if (v === undefined) continue;
        if (type === "s") value = strings[Number(v)] ?? "";
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else value = decodeXml(v);
      }
      cells[ref ? columnIndex(ref) : cells.length] = value.replace(/\s*\n\s*/g, " ");
    }
    if (cells.some((v) => v)) rows.push(Array.from(cells, (v) => v ?? "").join(" | "));
    if (rows.length >= maxRows) break;
  }
  return rows;
}

const filesMatching = (zip, rx) => Object.keys(zip.files).filter((p) => rx.test(p)).sort(byNumber);

async function readWord(zip) {
  const doc = await zip.file("word/document.xml")?.async("string");
  if (doc == null) throw new Error("not a Word document");
  return wordXmlToText(doc);
}

async function readPowerPoint(zip) {
  const slides = filesMatching(zip, /^ppt\/slides\/slide\d+\.xml$/);
  if (!slides.length) throw new Error("no slides found");
  const parts = [];
  for (const [i, path] of slides.entries()) {
    const text = drawingXmlToText(await zip.file(path).async("string"));
    const n = path.match(/(\d+)\.xml$/)[1];
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${n}.xml`)?.async("string");
    // Notes pages repeat the slide number as text; keep only real notes.
    const notes = notesXml ? drawingXmlToText(notesXml).split("\n").filter((l) => l.trim() && l.trim() !== n).join("\n") : "";
    parts.push(`Slide ${i + 1}:\n${text || "(no text)"}${notes ? `\nSpeaker notes: ${notes}` : ""}`);
  }
  return parts.join("\n\n");
}

async function readExcel(zip) {
  const strings = sharedStrings(await zip.file("xl/sharedStrings.xml")?.async("string"));
  const workbook = (await zip.file("xl/workbook.xml")?.async("string")) || "";
  const names = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const sheets = filesMatching(zip, /^xl\/worksheets\/sheet\d+\.xml$/);
  if (!sheets.length) throw new Error("no sheets found");
  const parts = [];
  for (const [i, path] of sheets.entries()) {
    const rows = sheetXmlToRows(await zip.file(path).async("string"), strings);
    parts.push(`Sheet: ${names[i] || `Sheet${i + 1}`}\n${rows.join("\n") || "(empty)"}`);
  }
  return parts.join("\n\n");
}

const READERS = { word: readWord, powerpoint: readPowerPoint, excel: readExcel };

// data: ArrayBuffer | Uint8Array | Blob. Resolves to the file's text (capped).
export async function extractOfficeText(data, kind) {
  const read = READERS[kind];
  if (!read) throw new Error("unsupported file type");
  const zip = await JSZip.loadAsync(data);
  return (await read(zip)).slice(0, OFFICE_TEXT_LIMIT);
}

// A file whose name/MIME type isn't recognised (a .tsx file arrives as
// "video/mp2t", many code files have no type at all) is still sent if its
// bytes are text.
export function looksLikeText(bytes) {
  const sample = bytes.subarray(0, 4096);
  let odd = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) odd++;
  }
  return odd <= sample.length * 0.02;
}
