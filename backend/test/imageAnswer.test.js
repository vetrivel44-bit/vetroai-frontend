const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = require("../src/app");
const orchestrator = require("../src/services/AIOrchestrator");
const { IMAGE_ANSWER_STYLE } = require("../src/services/imageAnswerPrompt");

async function captureParams(t, form) {
  const original = orchestrator.processRequest;
  let seen = null;
  orchestrator.processRequest = async (_reqId, params, res) => {
    seen = params;
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    return true;
  };
  t.after(() => { orchestrator.processRequest = original; });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: "POST", body: form });
  await response.text();
  return seen;
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

test("a turn with a picture is told to lead with the main subject, briefly", async (t) => {
  const form = new FormData();
  form.append("input", "what is this?");
  form.append("mode", "normal");
  form.append("systemPrompt", "Be friendly.");
  form.append("files", new Blob([PNG], { type: "image/png" }), "cat.png");
  const params = await captureParams(t, form);
  assert.ok(params.systemPrompt.startsWith("Be friendly."));
  assert.ok(params.systemPrompt.includes(IMAGE_ANSWER_STYLE));
  assert.equal(params.messages.at(-1).images.length, 1);
});

test("a text-only turn gets no image guidance", async (t) => {
  const form = new FormData();
  form.append("input", "hello");
  form.append("mode", "normal");
  const params = await captureParams(t, form);
  assert.ok(!params.systemPrompt.includes("ANSWERING ABOUT AN IMAGE"));
});

test("the browser-model copy of the image guidance matches the backend's", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/lib/imagePrompt.js"), "utf8");
  const literal = src.match(/export const IMAGE_ANSWER_STYLE = (".*");/)[1];
  assert.equal(JSON.parse(literal), IMAGE_ANSWER_STYLE);
});

// A Space's knowledge files ride at the end of the system prompt; at the old
// 2000-character cap they never reached the model.
test("a long custom system prompt reaches the model whole", async (t) => {
  const form = new FormData();
  form.append("input", "what does the handbook say about leave?");
  form.append("mode", "normal");
  const prompt = `Be helpful.\n\n[SPACE KNOWLEDGE FILES]\n${"Policy text. ".repeat(1500)}LEAVE: 24 days a year.`;
  form.append("systemPrompt", prompt);
  const params = await captureParams(t, form);
  // (multipart form fields arrive with \r\n line endings)
  assert.equal(params.systemPrompt.replace(/\r\n/g, "\n"), prompt.trim());
});
