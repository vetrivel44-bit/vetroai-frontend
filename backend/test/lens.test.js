const test = require("node:test");
const assert = require("node:assert/strict");

const { parseLens, imageFromDataUrl, readAndTranslate, lensMessages, LensError } = require("../src/services/lensService");

const PHOTO = `data:image/jpeg;base64,${Buffer.from("fake jpeg bytes").toString("base64")}`;

test("a photo arrives as a checked data URL", () => {
  assert.deepEqual(imageFromDataUrl(PHOTO), { mimeType: "image/jpeg", data: Buffer.from("fake jpeg bytes").toString("base64") });
  assert.throws(() => imageFromDataUrl("https://example.com/a.jpg"), (err) => err instanceof LensError && err.code === "IMAGE_REQUIRED");
  assert.throws(() => imageFromDataUrl("data:image/gif;base64,AAAA"), (err) => err.code === "IMAGE_FORMAT");
  const huge = `data:image/png;base64,${"A".repeat(9 * 1024 * 1024)}`;
  assert.throws(() => imageFromDataUrl(huge), (err) => err.code === "IMAGE_TOO_LARGE");
});

test("the model is asked to read, translate into the chosen language and explain", () => {
  const [system, user] = lensMessages({ image: { mimeType: "image/jpeg", data: "x" }, target: "ta" });
  assert.equal(system.role, "system");
  assert.match(user.content, /translate it into Tamil/);
  assert.match(user.content, /Never invent text/);
  assert.deepEqual(user.images, [{ mimeType: "image/jpeg", data: "x" }]);
});

test("the reading comes out of the model's JSON", () => {
  const raw = '```json\n{"language":"Tamil","text":"சூடான காபி ₹20","translation":"Hot coffee ₹20","explanation":"A café price board: hot coffee costs 20 rupees."}\n```';
  assert.deepEqual(parseLens(raw), { language: "Tamil", text: "சூடான காபி ₹20", translation: "Hot coffee ₹20", explanation: "A café price board: hot coffee costs 20 rupees." });
  assert.equal(parseLens("I can't read that"), null);
  assert.equal(parseLens('{"text":"","translation":"","explanation":""}'), null);
});

test("the vision models are tried in order until one reads it", async () => {
  const asked = [];
  const result = await readAndTranslate({
    image: PHOTO,
    target: "en",
    providers: ["gemini", "cohere", "groq"],
    ask: async (name) => {
      asked.push(name);
      if (name === "gemini") throw new Error("busy");
      if (name === "cohere") return "sorry";
      return '{"language":"Hindi","text":"धूम्रपान निषेध","translation":"No smoking","explanation":"Smoking is not allowed here."}';
    },
  });
  assert.deepEqual(asked, ["gemini", "cohere", "groq"]);
  assert.equal(result.translation, "No smoking");
  assert.equal(result.targetName, "English");
});

test("with no vision model, or none that reads it, the person is told plainly", async () => {
  await assert.rejects(readAndTranslate({ image: PHOTO, providers: [], ask: async () => "" }), (err) => err.code === "NO_VISION" && err.statusCode === 503);
  await assert.rejects(readAndTranslate({ image: PHOTO, providers: ["gemini"], ask: async () => "nope" }), (err) => err.code === "LENS_FAILED" && /Try again/.test(err.message));
});

test("/api/lens takes a photo bigger than the app's usual 1 MB limit", async (t) => {
  const app = require("../src/app");
  const providerManager = require("../src/services/ProviderManager");
  const orchestrator = require("../src/services/AIOrchestrator");
  const saved = { available: providerManager.getAvailableProviders, ask: orchestrator.askQuietly };
  providerManager.getAvailableProviders = () => ["groq", "gemini"];
  const asked = [];
  orchestrator.askQuietly = async (name, messages) => {
    asked.push(name);
    assert.equal(messages[1].images[0].mimeType, "image/jpeg");
    return '{"language":"Tamil","text":"வணக்கம்","translation":"Welcome","explanation":"A greeting sign."}';
  };
  const server = app.listen(0, "127.0.0.1");
  t.after(() => {
    providerManager.getAvailableProviders = saved.available;
    orchestrator.askQuietly = saved.ask;
    return new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/lens`;
  const big = `data:image/jpeg;base64,${Buffer.alloc(1.5 * 1024 * 1024, 7).toString("base64")}`;
  const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: big, target: "en" }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.translation, "Welcome");
  assert.deepEqual(asked, ["gemini"], "Gemini first, as for pictures in chat");
  const bad = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: "nope" }) });
  assert.equal(bad.status, 400);
});
