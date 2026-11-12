const test = require("node:test");
const assert = require("node:assert/strict");
const { config } = require("../src/config/env");
const airouterImage = require("../src/providers/airouterImage");

function withFetch(responses, fn) {
  return async () => {
    const realFetch = global.fetch;
    const savedKey = config.airouterApiKey;
    const calls = [];
    config.airouterApiKey = "test-key";
    global.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const r = responses.shift();
      return { ok: r.status === 200, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
    };
    try { await fn(calls); } finally { global.fetch = realFetch; config.airouterApiKey = savedKey; }
  };
}

test("generates with Gemini 3.1 Flash Lite Image on /images/generations", withFetch(
  [{ status: 200, body: { data: [{ b64_json: "AAAA" }] } }],
  async (calls) => {
    assert.equal(await airouterImage.generateImage("a cat"), "data:image/png;base64,AAAA");
    assert.match(calls[0].url, /\/images\/generations$/);
    assert.equal(calls[0].body.model, "google/gemini-3.1-flash-lite-image");
  },
));

test("falls back to chat completions when /images/generations fails", withFetch(
  [{ status: 400, body: { error: "nope" } },
   { status: 200, body: { choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,BBBB" } }] } }] } }],
  async (calls) => {
    assert.equal(await airouterImage.generateImage("a dog"), "data:image/png;base64,BBBB");
    assert.match(calls[1].url, /\/chat\/completions$/);
    assert.deepEqual(calls[1].body.modalities, ["image", "text"]);
  },
));

test("edits send the input image to the chat endpoint", withFetch(
  [{ status: 200, body: { choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,CCCC" } }] } }] } }],
  async (calls) => {
    assert.equal(await airouterImage.editImage("make it blue", ["data:image/png;base64,ZZ"]), "data:image/png;base64,CCCC");
    assert.equal(calls[0].body.messages[0].content[1].image_url.url, "data:image/png;base64,ZZ");
  },
));
