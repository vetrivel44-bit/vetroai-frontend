const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../src/config/env");
const service = require("../src/services/siteImageService");

function withFetch(impl, run) {
  const original = global.fetch;
  global.fetch = impl;
  return run().finally(() => { global.fetch = original; });
}
const json = (body) => ({ ok: true, status: 200, json: async () => body });

test.beforeEach(() => { service.clearCache(); config.pexelsApiKey = ""; });

test("cleans the subject and picks an orientation from the size", () => {
  assert.equal(service.cleanQuery("  Red Running-Shoes!! "), "red running shoes");
  assert.equal(service.orientationOf(1200, 600), "landscape");
  assert.equal(service.orientationOf(600, 900), "portrait");
  assert.equal(service.orientationOf(500, 500), "square");
});

test("uses Pexels when a key is configured", async () => {
  config.pexelsApiKey = "k";
  const calls = [];
  await withFetch(async (url, opts) => {
    calls.push({ url, auth: opts?.headers?.Authorization });
    return json({ photos: [{ src: { large2x: "https://images.pexels.com/shoe.jpg" } }] });
  }, async () => {
    const url = await service.findSiteImage({ q: "running shoes", w: 800, h: 600 });
    assert.equal(url, "https://images.pexels.com/shoe.jpg");
  });
  assert.match(calls[0].url, /api\.pexels\.com\/v1\/search\?query=running%20shoes&.*orientation=landscape/);
  assert.equal(calls[0].auth, "k");
});

test("falls back to Openverse without a Pexels key, and caches the lookup", async () => {
  let calls = 0;
  await withFetch(async (url) => {
    calls++;
    assert.match(url, /api\.openverse\.org/);
    return json({ results: [{ url: "https://live.staticflickr.com/a.jpg", width: 1600, filetype: "jpg" }] });
  }, async () => {
    assert.equal(await service.findSiteImage({ q: "latte art", w: 600, h: 600 }), "https://live.staticflickr.com/a.jpg");
    assert.equal(await service.findSiteImage({ q: "Latte art", w: 640, h: 640, i: 3 }), "https://live.staticflickr.com/a.jpg");
  });
  assert.equal(calls, 1);
});

test("ends at a keyword-tagged LoremFlickr photo when every lookup fails", async () => {
  await withFetch(async () => { throw new Error("offline"); }, async () => {
    const url = await service.findSiteImage({ q: "fresh bread loaf bakery", w: 900, h: 500 });
    assert.match(url, /^https:\/\/loremflickr\.com\/900\/500\/fresh%2Cbread%2Cloaf\/all\?lock=\d+$/);
  });
});

test("the route redirects to the photo and lets browsers cache it", async () => {
  const router = require("../src/routes/siteImageRoutes");
  const layer = router.stack.find((l) => l.route?.path === "/");
  const handler = layer.route.stack[0].handle;
  const headers = {};
  let redirected = null;
  const res = { set(k, v) { headers[k] = v; return this; } };
  await withFetch(async () => json({ results: [{ url: "https://example.org/cake.jpg" }] }), async () => {
    await new Promise((resolve, reject) => {
      handler({ query: { q: "birthday cake", w: "400", h: "300" } }, { ...res, redirect(code, url) { redirected = { code, url }; resolve(); } }, reject);
    });
  });
  assert.deepEqual(redirected, { code: 302, url: "https://example.org/cake.jpg" });
  assert.equal(headers["Cache-Control"], "public, max-age=86400");
});
