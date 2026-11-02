const test = require("node:test");
const assert = require("node:assert/strict");

const { getAttachmentContext, normalizeMessages } = require("../src/controllers/chatController");
const { extractPdfText, formAnswers } = require("../src/services/pdfText");

// A small, valid PDF: one array of text lines per page (Helvetica, no images).
function makePdf(pages) {
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const ops = lines.map((line, j) => `BT /F1 12 Tf 72 ${720 - j * 18} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    objects[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const worksheet = makePdf([
  ["Case Study Worksheet", "System studied: online checkout page", "Independent variable: button colour"],
  ["Dependent variable: conversion rate", "Q1. State your hypothesis."],
]);

// The reply this fixes: "I can't access or read the attached PDF file
// directly. Could you share the content...?" — a PDF uploaded as it is (the
// Computer tab, the desktop app) was refused instead of read.
test("an attached PDF is read, page by page", async () => {
  const context = await getAttachmentContext({ mimetype: "application/pdf", originalname: "worksheet.pdf", buffer: worksheet });
  assert.match(context, /^Attached file \(worksheet\.pdf, PDF, 2 pages\):/);
  assert.match(context, /\[Page 1\]\nCase Study Worksheet\nSystem studied: online checkout page\nIndependent variable: button colour/);
  assert.match(context, /\[Page 2\]\nDependent variable: conversion rate\nQ1\. State your hypothesis\./);
  assert.doesNotMatch(context, /could not/);
});

test("a PDF is recognised by its bytes even with a generic type or name", async () => {
  const context = await getAttachmentContext({ mimetype: "application/octet-stream", originalname: "upload", buffer: worksheet });
  assert.match(context, /Case Study Worksheet/);
});

test("a long PDF stops at the character limit and says how much was read", async () => {
  const pages = Array.from({ length: 30 }, (_, i) => Array.from({ length: 30 }, (_, j) => `Page ${i + 1} line ${j + 1} of the long report text`));
  const { text, pages: total, pagesRead } = await extractPdfText(makePdf(pages), { limit: 5000 });
  assert.equal(total, 30);
  assert.ok(pagesRead < 30);
  assert.ok(text.length <= 5000);
  const context = await getAttachmentContext({ mimetype: "application/pdf", originalname: "long.pdf", buffer: makePdf(pages) });
  assert.match(context, /^Attached file \(long\.pdf, PDF, 30 pages; only the first \d+ of 30 pages were read\):/);
});

test("a scanned PDF (no text layer) is reported as scanned, not as unreadable", async () => {
  const context = await getAttachmentContext({ mimetype: "application/pdf", originalname: "scan.pdf", buffer: makePdf([[], []]) });
  assert.match(context, /"scan\.pdf", a scanned PDF/);
  assert.match(context, /attach the pages as images/);
});

test("a damaged PDF is reported plainly", async () => {
  const broken = { mimetype: "application/pdf", originalname: "notes.pdf", buffer: Buffer.from("%PDF-1.7\n\u0000\u0001binary") };
  assert.match(await getAttachmentContext(broken), /"notes\.pdf", but the PDF could not be opened \(it may be damaged\)/);
});

test("text typed into a fillable PDF's fields is kept; empty fields are not listed", () => {
  assert.equal(formAnswers([
    { subtype: "Widget", fieldType: "Tx", fieldName: "Name", fieldValue: "Asha" },
    { subtype: "Widget", fieldType: "Tx", fieldName: "Text1", fieldValue: "" },
    { subtype: "Widget", fieldType: "Btn", fieldName: "Agree", fieldValue: "Yes" },
    { subtype: "Link", url: "https://example.com" },
  ]), "Filled-in form fields:\nName: Asha");
  assert.equal(formAnswers([]), "");
});

test("text files are read as text", async () => {
  const txt = { mimetype: "text/plain", originalname: "notes.txt", buffer: Buffer.from("hello world") };
  assert.equal(await getAttachmentContext(txt), "Attached file (notes.txt):\nhello world");
  // The app's saved copy of a PDF's text keeps the ".pdf" name; it is text.
  const restored = { mimetype: "text/plain", originalname: "worksheet.pdf", buffer: Buffer.from("Q1. Hypothesis: ____") };
  assert.equal(await getAttachmentContext(restored), "Attached file (worksheet.pdf):\nQ1. Hypothesis: ____");
});

// A code file the browser labels oddly (.tsx is "video/mp2t") is still read,
// and an unreadable binary is described instead of failing the whole chat.
test("text with an unusual MIME type is read; unknown binaries are reported", async () => {
  const tsx = { mimetype: "video/mp2t", originalname: "App.tsx", buffer: Buffer.from("export const A = () => <div />;") };
  assert.equal(await getAttachmentContext(tsx), "Attached file (App.tsx):\nexport const A = () => <div />;");
  const docx = { mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", originalname: "r.docx", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]) };
  assert.match(await getAttachmentContext(docx), /"r\.docx".*could not be extracted/);
  assert.equal(await getAttachmentContext({ mimetype: "image/png", originalname: "a.png", buffer: Buffer.from([0]) }), null);
});

// "Here's my worksheet" (PDF attached), then "fill it out": the second turn
// used to reach the model without the file.
test("a file attached earlier in the chat comes back with its message", () => {
  const messages = normalizeMessages(JSON.stringify([
    { role: "user", content: "Here is my case study", files: [{ name: "worksheet.txt", text: "[PDF: worksheet.pdf]\n\nIndependent variable: ____" }] },
    { role: "assistant", content: "Got it — a worksheet about an experiment." },
    { role: "user", content: "Fill out the worksheet", files: [] },
  ]), "Fill out the worksheet");
  assert.equal(messages.length, 3);
  assert.equal(
    messages[0].content,
    "Here is my case study\n\n[Files the user attached with this message]\nAttached file (worksheet.txt):\n[PDF: worksheet.pdf]\n\nIndependent variable: ____",
  );
  assert.equal(messages[1].content, "Got it — a worksheet about an experiment.");
  assert.equal(messages[2].content, "Fill out the worksheet");
});

test("earlier files share one budget, newest first; older ones are named", () => {
  const big = (n) => "x".repeat(n);
  const messages = normalizeMessages([
    { role: "user", content: "old", files: [{ name: "old.txt", text: big(5000) }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: "mid", files: [{ name: "mid.txt", text: big(15000) }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: "new", files: [{ name: "new.txt", text: big(19000) }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: "and now?" },
  ], "and now?");
  assert.match(messages[4].content, /Attached file \(new\.txt\):\nx{19000}$/);
  assert.match(messages[2].content, /Attached file \(mid\.txt\):\nx{1000}\n\[…the rest of this file was cut to fit/);
  assert.match(messages[0].content, /Earlier the user attached "old\.txt"\. Its text is no longer in view/);
  // Names alone (images, or files saved before their text was kept) change nothing.
  const plain = normalizeMessages([{ role: "user", content: "hi", files: [{ name: "a.png" }] }], "hi");
  assert.deepEqual(plain, [{ role: "user", content: "hi" }]);
});

// End to end: a PDF uploaded to /api/chat as it is (as the Computer tab sends
// it) reaches the model as text, ahead of the user's question.
test("POST /api/chat with a raw PDF hands the model the PDF's text", async (t) => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const original = orchestrator.processRequest;
  let seen = null;
  orchestrator.processRequest = async (reqId, params, res) => {
    seen = params;
    res.write(`data: ${JSON.stringify({ text: "ok" })}\n\n`);
    return true;
  };
  t.after(() => { orchestrator.processRequest = original; });

  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const body = new FormData();
  body.append("input", "Fill out this worksheet");
  body.append("messages", JSON.stringify([{ role: "user", content: "Fill out this worksheet" }]));
  body.append("files", new Blob([worksheet], { type: "application/pdf" }), "worksheet.pdf");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: "POST", body });
  const stream = await response.text();

  assert.equal(response.status, 200);
  assert.ok(seen, "the request reached the model");
  const question = seen.messages[seen.messages.length - 1];
  assert.equal(question.role, "user");
  assert.match(question.content, /^Attached file \(worksheet\.pdf, PDF, 2 pages\):\n\[Page 1\]\nCase Study Worksheet/);
  assert.match(question.content, /User's question about the file: Fill out this worksheet$/);
  assert.equal(seen.hasAttachments, true);
  // The app is sent the text back, to save with the message for later turns.
  const sent = stream.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
  const attachments = sent.find((e) => e.type === "attachments");
  assert.equal(attachments.data.length, 1);
  assert.equal(attachments.data[0].name, "worksheet.pdf");
  assert.match(attachments.data[0].text, /^\[Page 1\]\nCase Study Worksheet/);
});
