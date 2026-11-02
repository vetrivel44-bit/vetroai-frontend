// The text of an attached PDF, read on the server.
//
// The web app turns PDFs into text before it sends them, but not every client
// does: the Computer tab, the desktop app and anything calling /chat directly
// upload the PDF as it is. Those used to be refused ("its text could not be
// extracted"), so the model told the user it couldn't read the PDF they had
// just attached. This reads the PDF's text layer with PDF.js, the same library
// the web app uses. A scanned PDF has no text layer and comes back empty.

const MAX_PAGES = 40;
const TIMEOUT_MS = 15000;

let pdfjsPromise = null;
function loadPdfjs() {
  // PDF.js is an ES module; CommonJS reaches it with import(). Loaded on the
  // first PDF, not at start-up.
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

// Known by its header (which may follow a little junk), not its name or type:
// a document the app saved as text keeps its ".pdf" name.
const isPdf = (file) => Boolean(file?.buffer?.length) && file.buffer.subarray(0, 1024).includes("%PDF-");

// A page's text items, in reading order, with line breaks where PDF.js marks
// the end of a line. Joining every item with a space ran a worksheet's
// questions and blanks together into one paragraph.
function pageText(items) {
  let out = "";
  for (const item of items) {
    if (typeof item?.str !== "string") continue;
    out += item.str;
    out += item.hasEOL ? "\n" : item.str && !/\s$/.test(item.str) ? " " : "";
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// What was typed into a fillable form (a worksheet's answers) is not part of
// the page's text, so it is listed after it. Empty fields are left out: their
// names are usually just "Text1".
function formAnswers(annotations) {
  const filled = (annotations || [])
    .filter((a) => a?.subtype === "Widget" && a.fieldType === "Tx" && typeof a.fieldValue === "string" && a.fieldValue.trim())
    .map((a) => `${String(a.alternativeText || a.fieldName || "Field").trim()}: ${a.fieldValue.trim()}`);
  return filled.length ? `Filled-in form fields:\n${filled.join("\n")}` : "";
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new Error("PDF reading timed out")); }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Reads the text of a PDF buffer.
 * @returns {Promise<{ text: string, pages: number, pagesRead: number }>}
 *   `text` is empty for a scanned PDF. Throws for a file PDF.js can't open
 *   (damaged, or protected by a password).
 */
async function extractPdfText(buffer, { limit = 20000, maxPages = MAX_PAGES, timeoutMs = TIMEOUT_MS } = {}) {
  const pdfjs = await loadPdfjs();
  // PDF.js takes the bytes over, so it gets its own copy. Nothing here draws
  // the pages, so fonts are never turned into code (isEvalSupported) or loaded.
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const read = async () => {
    const doc = await task.promise;
    try {
      const pages = [];
      let length = 0;
      const last = Math.min(doc.numPages, maxPages);
      for (let i = 1; i <= last && length < limit; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const answers = formAnswers(await page.getAnnotations().catch(() => []));
        const text = [pageText(content.items), answers].filter(Boolean).join("\n\n");
        page.cleanup();
        pages.push(text);
        length += text.length;
      }
      // Page breaks are only marked when there is more than one page.
      const text = (pages.length > 1
        ? pages.map((t, i) => (t ? `[Page ${i + 1}]\n${t}` : "")).filter(Boolean).join("\n\n")
        : pages[0] || ""
      ).slice(0, limit);
      // Only a text layer with some real content counts; a scan often has a
      // stray page number or a few characters of OCR noise.
      const meaningful = text.replace(/\[Page \d+\]/g, "").replace(/\s+/g, "").length >= 20;
      return { text: meaningful ? text : "", pages: doc.numPages, pagesRead: pages.length };
    } finally {
      await doc.destroy().catch(() => {});
    }
  };
  return withTimeout(read(), timeoutMs, () => { task.destroy().catch(() => {}); });
}

module.exports = { extractPdfText, isPdf, pageText, formAnswers };
