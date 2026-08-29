import { downloadBlob } from "./mediaDownloads";

const clean = (value) => String(value ?? "").trim();
const safeName = (name) => (clean(name) || "vetroai-response").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const exportResponse = async ({ content, format, filename = "vetroai-response" }) => {
  const text = clean(content);
  if (!text) throw new Error("There is no response content to export.");
  const base = safeName(filename);
  const kind = String(format || "txt").toLowerCase();

  if (kind === "txt" || kind === "md" || kind === "markdown") {
    const ext = kind === "txt" ? "txt" : "md";
    downloadBlob(new Blob([text], { type: ext === "txt" ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8" }), `${base}.${ext}`);
    return;
  }
  if (kind === "csv") {
    const rows = text.split(/\r?\n/).filter(Boolean).map((line) => `"${line.replace(/"/g, '""')}"`).join("\r\n");
    downloadBlob(new Blob([`Content\r\n${rows}`], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
    return;
  }
  if (kind === "html") {
    const html = `<!doctype html><meta charset="utf-8"><title>VetroAI response</title><main style="max-width:800px;margin:40px auto;font:16px/1.65 system-ui;white-space:pre-wrap">${escapeHtml(text)}</main>`;
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${base}.html`);
    return;
  }

  // Binary office formats must be produced by the server; never fake a PDF/DOCX/XLSX
  // with an HTML blob because browsers then open a blank/corrupt document.
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text, format: kind, filename: base }),
  });
  if (!response.ok) throw new Error(`Could not create ${kind.toUpperCase()} export.`);
  const blob = await response.blob();
  if (!blob.size) throw new Error(`The ${kind.toUpperCase()} export was empty.`);
  downloadBlob(blob, `${base}.${kind}`);
};
