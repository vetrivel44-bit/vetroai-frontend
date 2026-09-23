import test from "node:test";
import assert from "node:assert/strict";

import { buildMessages, pickModel, isVisionModel, latestSharedImage, setupHelp } from "../src/lib/localOllama.js";

test("vision models are recognised from name or family", () => {
  assert.equal(isVisionModel({ name: "llama3.2-vision:latest", details: { families: ["mllama"] } }), true);
  assert.equal(isVisionModel({ name: "moondream:latest", details: { family: "phi2" } }), true);
  assert.equal(isVisionModel({ name: "llama3.2:latest", details: { family: "llama" } }), false);
});

test("model choice prefers llama3.2-vision, then moondream, and needs vision for images", () => {
  const models = [{ name: "llama3.2:latest", vision: false }, { name: "moondream:latest", vision: true },
    { name: "llama3.2-vision:latest", vision: true }];
  assert.equal(pickModel(models, { needsVision: true }), "llama3.2-vision:latest");
  assert.equal(pickModel(models.slice(0, 2), { needsVision: true }), "moondream:latest");
  assert.equal(pickModel([models[0]], { needsVision: true }), null);
  assert.equal(pickModel([models[0]]), "llama3.2:latest");
  assert.equal(pickModel(models, { needsVision: true, exclude: ["llama3.2-vision:latest"] }), "moondream:latest");
});

test("the image rides on the turn it was shared with, and no system prompt goes with it", () => {
  const history = [{ role: "user", content: "look" }, { role: "assistant", content: "a cat" }];
  const withImage = buildMessages({ history, question: "eye colour?", imageDataUrl: "data:image/jpeg;base64,x",
    imageTurnsAgo: 1, systemPrompt: "be nice" });
  assert.deepEqual(withImage.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(withImage[0].content[1].image_url.url, "data:image/jpeg;base64,x");
  assert.equal(withImage[2].content, "eye colour?");
  const textOnly = buildMessages({ history: [], question: "hi", systemPrompt: "be nice" });
  assert.deepEqual(textOnly, [{ role: "system", content: "be nice" }, { role: "user", content: "hi" }]);
  assert.equal(buildMessages({ history: [], question: "", imageDataUrl: "d" })[0].content[0].text, "Describe this image in detail.");
});

test("follow-ups find the latest shared image and how many turns back it was", () => {
  const history = [
    { role: "user", content: "old", files: [{ name: "a.png", preview: "data:image/png;base64,AAA" }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: "new", files: [{ name: "b.png", preview: "data:image/png;base64,BBB" }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: "follow-up" },
  ];
  assert.deepEqual(latestSharedImage(history), { preview: "data:image/png;base64,BBB", turnsAgo: 1 });
  assert.equal(latestSharedImage([{ role: "user", content: "x", files: [{ name: "doc.pdf", preview: null }] }]), null);
});

test("setup help names this site as the allowed origin", () => {
  const help = setupHelp("https://vetroai.pages.dev");
  assert.match(help, /OLLAMA_ORIGINS/);
  assert.match(help, /setx OLLAMA_ORIGINS "https:\/\/vetroai\.pages\.dev"/);
  assert.match(help, /ollama pull llama3\.2-vision/);
});
