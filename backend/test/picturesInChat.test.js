const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");
const providerManager = require("../src/services/ProviderManager");
const { PICTURES_IN_CHAT, ABOUT_PICTURES } = require("../src/config/aboutVetroAI");

test("VetroAI knows its chat shows and makes pictures", () => {
  assert.match(PICTURES_IN_CHAT, /This chat shows and makes pictures/);
  assert.match(PICTURES_IN_CHAT, /never offer to write a prompt for another tool/);
  assert.match(PICTURES_IN_CHAT, /```image block/, "asked for a picture, it asks the app to make one");
  assert.match(PICTURES_IN_CHAT, /never say it's text-only or that you can't show, make or see images/);
  assert.match(PICTURES_IN_CHAT, /Create an image of/);
  assert.match(PICTURES_IN_CHAT, /tap \+ → Create image/);
  for (const q of ["Can you show images?", "Can ChatGPT show pictures?", "make me a logo", "what does it look like", "make a cartoon of a cat", "ஒரு பூனையின் படம் உருவாக்கு", "एक बिल्ली की तस्वीर बनाओ"]) assert.ok(ABOUT_PICTURES.test(q), q);
  assert.equal(ABOUT_PICTURES.test("compare rainfall in chennai and mumbai"), false);
});

test("asking to see something real brings up photos; asking about images doesn't", () => {
  for (const q of ["show me photos of Ooty", "show photos of the Taj Mahal", "can you show me some pictures of tigers", "how does a quokka look", "pictures of Chennai beach"]) {
    assert.equal(orchestrator.needsImageSearch(q), true, q);
  }
  for (const q of ["Can ChatGPT show images?", "Can you show images?", "What is photosynthesis", "show me how to cook rice", "create an image of a cat in space"]) {
    assert.equal(orchestrator.needsImageSearch(q), false, q);
  }
});

async function systemFor(t, input) {
  let system = "";
  const originals = [];
  const patch = (target, name, fn) => { originals.push([target, name, target[name]]); target[name] = fn; };
  patch(providerManager, "getBestProvider", () => "groq");
  patch(providerManager, "getAdapter", () => ({
    generateStream: async (messages) => { system = messages[0].content; return (async function* () { yield 'data: {"choices":[{"delta":{"content":"Here they are."}}]}\n'; })(); },
  }));
  patch(providerManager, "getAvailableProviders", () => ["groq"]);
  patch(providerManager, "isConfigured", (name) => name === "groq");
  patch(providerManager, "updateMetrics", () => {});
  t.after(() => { for (const [target, name, fn] of originals.reverse()) target[name] = fn; });
  const res = { write: () => {}, end: () => {}, writableEnded: false, locals: {} };
  await orchestrator.processRequest(`t_${Math.random()}`, { messages: [{ role: "user", content: input }], mode: "normal", options: {} }, res);
  for (const [target, name, fn] of originals.reverse()) target[name] = fn;
  originals.length = 0;
  return system;
}

test("when photos are shown, the model is told so", async (t) => {
  const system = await systemFor(t, "show me photos of Ooty");
  assert.match(system, /\[PHOTOS SHOWN\]/);
  assert.match(system, /PICTURES IN THIS CHAT/);
});

test("asked whether it can show images, the model is told what the chat can do", async (t) => {
  const asked = await systemFor(t, "Can you show images in this chat?");
  assert.match(asked, /PICTURES IN THIS CHAT/);
  assert.doesNotMatch(asked, /\[PHOTOS SHOWN\]/, "no photos for a question about images");
  const other = await systemFor(t, "Explain how monsoon winds form over India");
  assert.doesNotMatch(other, /PICTURES IN THIS CHAT/, "other messages don't carry it");
});
