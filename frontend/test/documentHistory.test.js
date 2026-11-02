import test from "node:test";
import assert from "node:assert/strict";

import { DOC_TEXT_LIMIT, documentText, historyForServer, withEarlierDocuments, withServerText } from "../src/lib/documentHistory.js";
import { readDocuments } from "../src/lib/localOllama.js";

const pdfText = "[PDF: worksheet.pdf]\n\nCase Study Worksheet\nIndependent variable: ____";
const chat = [
  { role: "user", content: "Here is my case study", files: [{ name: "worksheet.txt", size: 70, preview: null, text: pdfText }] },
  { role: "assistant", content: "Got it — a worksheet about an experiment." },
  { role: "user", content: "Fill out the worksheet" },
];

test("a document's text is saved with its message; images and binaries are not", async () => {
  assert.equal(await documentText(new File([pdfText], "worksheet.txt", { type: "text/plain" })), pdfText);
  assert.equal(await documentText(new File(["{\"a\":1}"], "a.json", { type: "application/json" })), "{\"a\":1}");
  assert.equal(await documentText(new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" })), null);
  assert.equal(await documentText(new File(["%PDF-1.7"], "raw.pdf", { type: "application/pdf" })), null);
  assert.equal(await documentText(new File(["  "], "empty.txt", { type: "text/plain" })), null);
  const long = await documentText(new File(["x".repeat(DOC_TEXT_LIMIT + 50)], "long.txt", { type: "text/plain" }));
  assert.equal(long.length, DOC_TEXT_LIMIT);
});

// "Here's my worksheet", then "fill it out": the follow-up used to reach the
// model with only the file's name, and it said it couldn't read the PDF.
test("the backend gets earlier documents' text; this turn's files only by name", () => {
  const preview = "data:image/png;base64,AAAA";
  const sent = historyForServer([...chat.slice(0, 2), { role: "user", content: "and this?", files: [{ name: "b.txt", text: "new", preview }] }]);
  assert.deepEqual(sent[0].files, [{ name: "worksheet.txt", text: pdfText }]);
  assert.deepEqual(sent[2].files, [{ name: "b.txt" }]);
  assert.equal(sent[1], chat[1]);
  // Image previews are never sent.
  assert.deepEqual(historyForServer([{ role: "user", content: "x", files: [{ name: "a.png", preview }] }, chat[2]])[0].files, [{ name: "a.png" }]);
});

test("browser models get earlier documents in the messages they came with", () => {
  const out = withEarlierDocuments(chat);
  assert.equal(out[0].content, `Here is my case study\n\n[Files the user attached with this message]\nAttached file (worksheet.txt):\n${pdfText}`);
  assert.equal(out[1], chat[1]);
  assert.equal(out[2], chat[2]);
  // The latest message is left for this turn's own attachments.
  const latest = withEarlierDocuments([chat[0]]);
  assert.equal(latest[0], chat[0]);
});

test("earlier documents share one budget, newest first; older ones are named", () => {
  const out = withEarlierDocuments([
    { role: "user", content: "old", files: [{ name: "old.txt", text: "o".repeat(50) }] },
    { role: "user", content: "", files: [{ name: "new.txt", text: "n".repeat(80) }] },
    { role: "user", content: "question" },
  ], 100);
  assert.equal(out[1].content, `(no message)\n\n[Files the user attached with this message]\nAttached file (new.txt):\n${"n".repeat(80)}`);
  assert.match(out[0].content, /Attached file \(old\.txt\):\no{20}\n\[…the rest of this file was cut to fit/);
  const full = withEarlierDocuments([
    { role: "user", content: "old", files: [{ name: "old.txt", text: "o".repeat(50) }] },
    { role: "user", content: "big", files: [{ name: "big.txt", text: "b".repeat(100) }] },
    { role: "user", content: "q" },
  ], 100);
  assert.match(full[1].content, /Attached file \(big\.txt\):\nb{100}$/);
  assert.equal(full[0].content, 'old\n\n[Files the user attached with this message]\n[Earlier the user attached "old.txt". Its text is no longer in view; if the answer needs it, say so and ask them to attach it again.]');
});

test("a raw PDF is never read as a text document by browser models", async () => {
  const raw = new File(["%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"], "worksheet.pdf", { type: "application/pdf" });
  assert.equal(await readDocuments([raw]), null);
  assert.equal(await readDocuments([new File(["%PDF-1.4\nplain"], "upload", { type: "" })]), null);
  assert.deepEqual(await readDocuments([new File(["notes"], "n.txt", { type: "text/plain" })]), [{ name: "n.txt", text: "notes" }]);
  // A document restored from its saved text keeps its ".pdf" name; it is text.
  assert.deepEqual(await readDocuments([new File(["Q1. ____"], "worksheet.pdf", { type: "text/plain" })]), [{ name: "worksheet.pdf", text: "Q1. ____" }]);
});

// A PDF the browser couldn't read went to the server as it is; the text the
// server read comes back and is saved with the message, for later turns.
test("text the server read is saved onto the files it came from", () => {
  const files = [{ name: "worksheet.pdf", size: 900, preview: null }, { name: "cat.png", preview: "data:image/png;base64,AA" }];
  const saved = withServerText(files, [{ name: "worksheet.pdf", text: "Case Study Worksheet" }]);
  assert.deepEqual(saved, [{ name: "worksheet.pdf", size: 900, preview: null, text: "Case Study Worksheet" }, files[1]]);
  // Nothing to add: the same array back, so the chat isn't re-saved.
  assert.equal(withServerText(files, [{ name: "other.pdf", text: "x" }]), files);
  assert.equal(withServerText(files, []), files);
  assert.equal(withServerText(undefined, [{ name: "a", text: "b" }]), undefined);
  const already = [{ name: "a.pdf", text: "kept" }];
  assert.equal(withServerText(already, [{ name: "a.pdf", text: "new" }]), already);
});
