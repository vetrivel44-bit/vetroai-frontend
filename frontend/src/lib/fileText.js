import { officeKind, extractOfficeText, looksLikeText } from "./officeText";

// The text of a file the user picked: PDF (text layer), Word/PowerPoint/Excel,
// or anything that is plain text. Empty for images, scans and binaries.

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.js?url")]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  pdfjs = lib;
  return lib;
}

export const READABLE_DOC = /\.(pdf|docx|pptx|xlsx|txt|md|csv|json|html?|rtf)$/i;

export async function extractFileText(file, limit = 20000) {
  const name = file.name || "";
  if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
    const lib = await loadPdfjs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 20) && text.length < limit; i++) {
      const page = await pdf.getPage(i);
      text += (await page.getTextContent()).items.map((item) => item.str).join(" ") + "\n";
    }
    return text.replace(/[ \t]+/g, " ").trim().slice(0, limit);
  }
  const kind = officeKind(name);
  if (kind && kind !== "legacy") return (await extractOfficeText(file, kind)).slice(0, limit);
  if (kind === "legacy") return "";
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (!looksLikeText(head)) return "";
  return (await file.text()).slice(0, limit);
}
