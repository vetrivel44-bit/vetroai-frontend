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
