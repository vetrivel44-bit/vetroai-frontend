import { test } from "node:test";
import assert from "node:assert/strict";
import { LENS_LANGUAGES, askAboutPhoto, defaultTarget, fitSize, readPhoto, saveTarget, savedTarget } from "../src/lib/lens.js";

test("it translates into the language picked last, else the browser's, else English", () => {
  assert.equal(defaultTarget({ saved: "hi", languages: ["en-US"] }), "hi");
  assert.equal(defaultTarget({ saved: "", languages: ["ta-IN", "en"] }), "ta");
  assert.equal(defaultTarget({ saved: "xx", languages: ["zz"] }), "en");
  assert.ok(LENS_LANGUAGES.some(([code]) => code === "ta") && LENS_LANGUAGES.some(([code]) => code === "hi"));
});

test("the picked language is remembered on this device", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveTarget("ml", storage);
  assert.equal(savedTarget(storage), "ml");
  saveTarget("klingon", storage);
  assert.equal(savedTarget(storage), "ml", "only languages it knows");
});

test("photos are sent at most 1600 px on the long side, never enlarged", () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitSize(1080, 1920), { width: 900, height: 1600 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
});

test("a photo goes to the server with the language, and errors come back readable", async () => {
  let sent = null;
  const data = await readPhoto("/api", "data:image/jpeg;base64,AAA", "ta", {
    fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ data: { translation: "வணக்கம்" } }) }; },
  });
  assert.equal(sent.url, "/api/lens");
  assert.deepEqual(sent.body, { image: "data:image/jpeg;base64,AAA", target: "ta" });
  assert.equal(data.translation, "வணக்கம்");
  await assert.rejects(readPhoto("/api", "x", "en", { fetchImpl: async () => ({ ok: false, json: async () => ({ message: "That photo is too large." }) }) }), /too large/);
  await assert.rejects(readPhoto("/api", "x", "en", { fetchImpl: async () => { throw new TypeError("offline"); } }), /Check your connection/);
});

test("Ask VetroAI takes the photo's text and translation to the chat", () => {
  const prompt = askAboutPhoto({ language: "Hindi", text: "धूम्रपान निषेध", translation: "No smoking", targetName: "English" });
  assert.match(prompt, /^I took a photo of some Hindi text\./);
  assert.match(prompt, /It says:\nधूम्रपान निषेध/);
  assert.match(prompt, /Translation \(English\):\nNo smoking/);
  const noText = askAboutPhoto({ text: "", translation: "", explanation: "A street with a red bus." });
  assert.match(noText, /There was no text in it\. It shows: A street with a red bus\./);
});
