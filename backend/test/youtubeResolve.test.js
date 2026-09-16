const test = require("node:test");
const assert = require("node:assert/strict");

const youtubeController = require("../src/controllers/youtubeController");

function fakeRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

function withFetch(impl, run) {
  const original = global.fetch;
  global.fetch = impl;
  return run().finally(() => { global.fetch = original; });
}

const okHtml = (body) => async () => ({ ok: true, status: 200, text: async () => body });

// Shaped like the embedded JSON YouTube ships in the search page, where the
// first videoId is the top result and the title follows it.
const SEARCH_HTML = `<!DOCTYPE html><html><script>var ytInitialData = {"contents":{"items":[
{"videoRenderer":{"videoId":"dQw4w9WgXcQ","title":{"runs":[{"text":"First Result \\u0026 Friends"}]}}},
{"videoRenderer":{"videoId":"aaaaaaaaaaa","title":{"runs":[{"text":"Second Result"}]}}}
]}};</script></html>`;

test("resolves the first video id and builds a watch url", async () => {
  const res = fakeRes();
  await withFetch(okHtml(SEARCH_HTML), () =>
    youtubeController.resolveFirstVideo({ query: { q: "never gonna give you up" } }, res));

  assert.equal(res.payload.success, true);
  assert.equal(res.payload.data.videoId, "dQw4w9WgXcQ");
  assert.equal(res.payload.data.watchUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  // Escaped sequences in the embedded JSON must come back as real text.
  assert.equal(res.payload.data.title, "First Result & Friends");
});

test("a missing query is rejected rather than searched for nothing", async () => {
  const res = fakeRes();
  await youtubeController.resolveFirstVideo({ query: { q: "   " } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
});

// The caller falls back to the search page on success:false, so these must not
// throw or return a half-built result.
test("html with no video id reports failure instead of guessing", async () => {
  const res = fakeRes();
  await withFetch(okHtml("<html>consent wall, no videos here</html>"), () =>
    youtubeController.resolveFirstVideo({ query: { q: "anything" } }, res));
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.data, undefined);
});

test("an unreachable YouTube reports failure instead of throwing", async () => {
  const res = fakeRes();
  await withFetch(async () => { throw new Error("ENOTFOUND"); }, () =>
    youtubeController.resolveFirstVideo({ query: { q: "anything" } }, res));
  assert.equal(res.payload.success, false);
});

test("a non-200 from YouTube reports failure instead of parsing the error body", async () => {
  const res = fakeRes();
  await withFetch(async () => ({ ok: false, status: 429, text: async () => "slow down" }), () =>
    youtubeController.resolveFirstVideo({ query: { q: "anything" } }, res));
  assert.equal(res.payload.success, false);
});

test("a title that isn't present still yields a usable video", async () => {
  const res = fakeRes();
  await withFetch(okHtml('{"videoId":"abcdefghijk"}'), () =>
    youtubeController.resolveFirstVideo({ query: { q: "anything" } }, res));
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.data.videoId, "abcdefghijk");
  assert.equal(res.payload.data.title, null);
});
