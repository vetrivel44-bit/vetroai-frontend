const test = require("node:test");
const assert = require("node:assert/strict");

// A PDF's raw bytes must never reach the model as "text".
test("binary attachments are reported, not decoded as text", async () => {
  const mod = require("../src/controllers/chatController");
  const { getAttachmentContext } = mod;
  const pdf = { mimetype: "application/pdf", originalname: "notes.pdf", buffer: Buffer.from("%PDF-1.7\n\u0000\u0001binary") };
  assert.match(getAttachmentContext(pdf), /could not be extracted/);
  const txt = { mimetype: "text/plain", originalname: "notes.txt", buffer: Buffer.from("hello world") };
  assert.equal(getAttachmentContext(txt), "Attached file (notes.txt):\nhello world");
});

// A code file the browser labels oddly (.tsx is "video/mp2t") is still read,
// and an unreadable binary is described instead of failing the whole chat.
test("text with an unusual MIME type is read; unknown binaries are reported", () => {
  const { getAttachmentContext } = require("../src/controllers/chatController");
  const tsx = { mimetype: "video/mp2t", originalname: "App.tsx", buffer: Buffer.from("export const A = () => <div />;") };
  assert.equal(getAttachmentContext(tsx), "Attached file (App.tsx):\nexport const A = () => <div />;");
  const docx = { mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", originalname: "r.docx", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]) };
  assert.match(getAttachmentContext(docx), /"r\.docx".*could not be extracted/);
  assert.equal(getAttachmentContext({ mimetype: "image/png", originalname: "a.png", buffer: Buffer.from([0]) }), null);
});
