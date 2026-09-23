import test from "node:test";
import assert from "node:assert/strict";

import { buildMessages, pickModel, isVisionModel, latestSharedImage, readDocuments, documentChars, documentCharBudget, withDocuments } from "../src/lib/localOllama.js";

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

test("documents prefer a general chat model and put the picture captioner last", () => {
  const models = [{ name: "moondream:latest", vision: true }, { name: "llama3.2-vision:latest", vision: true },
    { name: "llama3.2:latest", vision: false }];
  assert.equal(pickModel(models, { forText: true }), "llama3.2:latest");
  assert.equal(pickModel(models.slice(0, 2), { forText: true }), "llama3.2-vision:latest");
  assert.equal(pickModel([models[0]], { forText: true }), "moondream:latest");
  assert.ok(documentCharBudget("moondream:latest") < documentCharBudget("llama3.2:latest"));
});

test("text files are read, binary files are refused, and the question follows the file", async () => {
  const notes = new File(["Invoice total: $420\nDue: 5 May"], "notes.txt", { type: "text/plain" });
  const docs = await readDocuments([notes]);
  assert.deepEqual(docs, [{ name: "notes.txt", text: "Invoice total: $420\nDue: 5 May" }]);
  assert.equal(documentChars(docs), 30);
  assert.equal(await readDocuments([new File([new Uint8Array([0, 1, 2, 0, 255])], "x.bin")]), null);
  const message = withDocuments(docs, "What is the total?");
  assert.match(message, /--- File: notes.txt ---\nInvoice total: \$420/);
  assert.match(message, /Question: What is the total\?$/);
});
