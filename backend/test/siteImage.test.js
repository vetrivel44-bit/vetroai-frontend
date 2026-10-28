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

const commonsPage = (index, thumburl, width, height, title = "File:Latte art cake.jpg") => ({ index, title, imageinfo: [{ thumburl, width, height, mime: "image/jpeg" }] });

test("uses Wikimedia Commons without a Pexels key, prefers the slot's shape, and caches the lookup", async () => {
  let calls = 0;
  await withFetch(async (url) => {
    calls++;
    assert.match(url, /commons\.wikimedia\.org\/w\/api\.php\?.*gsrsearch=latte\+art\+filetype%3Abitmap/);
    return json({ query: { pages: {
      a: commonsPage(1, "https://upload.wikimedia.org/wide.jpg", 1600, 900),
      b: commonsPage(2, "https://upload.wikimedia.org/square.jpg", 1000, 1000),
      c: { index: 3, imageinfo: [{ thumburl: "https://upload.wikimedia.org/map.svg", width: 1000, height: 1000, mime: "image/svg+xml" }] },
    } } });
  }, async () => {
    assert.equal(await service.findSiteImage({ q: "latte art", w: 600, h: 600 }), "https://upload.wikimedia.org/square.jpg");
    await service.findSiteImage({ q: "Latte art", w: 640, h: 640, i: 3 });
  });
  assert.equal(calls, 1);
});

test("Commons drops shot words, skips loosely matched files, and retries with the last two words", async () => {
  const searches = [];
  await withFetch(async (url) => {
    const q = new URL(url).searchParams.get("gsrsearch");
    searches.push(q);
    if (q === "gold smart watch filetype:bitmap") {
      return json({ query: { pages: { a: commonsPage(1, "https://upload.wikimedia.org/book.jpg", 800, 800, "File:Highways and byways (gold).jpg") } } });
    }
    return json({ query: { pages: { a: commonsPage(1, "https://upload.wikimedia.org/watch.jpg", 800, 800, "File:Smart watch on wrist.jpg") } } });
  }, async () => {
    assert.equal(await service.findSiteImage({ q: "gold smart watch product photo", w: 800, h: 800 }), "https://upload.wikimedia.org/watch.jpg");
  });
  assert.deepEqual(searches, ["gold smart watch filetype:bitmap", "smart watch filetype:bitmap"]);
});

test("falls back to Openverse when Commons has nothing", async () => {
  await withFetch(async (url) => {
    if (/commons\.wikimedia\.org/.test(url)) return json({});
    assert.match(url, /api\.openverse\.org/);
    return json({ results: [{ url: "https://live.staticflickr.com/a.jpg", width: 1600, filetype: "jpg" }] });
  }, async () => {
    assert.equal(await service.findSiteImage({ q: "latte art", w: 600, h: 600 }), "https://live.staticflickr.com/a.jpg");
  });
});

test("finds nothing when every lookup fails, and the placeholder is a labelled image of the asked size", async () => {
  await withFetch(async () => { throw new Error("offline"); }, async () => {
    assert.equal(await service.findSiteImage({ q: "fresh bread loaf bakery", w: 900, h: 500 }), null);
  });
  const svg = service.placeholderSvg({ q: "Fresh <bread> & loaf", w: 900, h: 500 });
  assert.match(svg, /^<svg [^>]*width="900" height="500"/);
  assert.match(svg, />fresh bread loaf<\/text>/);
  assert.doesNotMatch(svg, /<bread>/);
});

function routeHandler() {
  const router = require("../src/routes/siteImageRoutes");
  return router.stack.find((l) => l.route?.path === "/").route.stack[0].handle;
}

test("the route redirects to the photo and lets browsers cache it", async () => {
  const handler = routeHandler();
  const headers = {};
  let redirected = null;
  const res = { set(k, v) { headers[k] = v; return this; } };
  await withFetch(async () => json({ query: { pages: { a: commonsPage(1, "https://example.org/cake.jpg", 800, 600) } } }), async () => {
    await new Promise((resolve, reject) => {
      handler({ query: { q: "birthday cake", w: "400", h: "300" } }, { ...res, redirect(code, url) { redirected = { code, url }; resolve(); } }, reject);
    });
  });
  assert.deepEqual(redirected, { code: 302, url: "https://example.org/cake.jpg" });
  assert.equal(headers["Cache-Control"], "public, max-age=86400");
});

test("the route serves the placeholder image, briefly cached, when no photo is found", async () => {
  const handler = routeHandler();
  const headers = {};
  let sent = null;
  let type = null;
  const res = {
    set(k, v) { headers[k] = v; return this; },
    type(t) { type = t; return this; },
    redirect() { throw new Error("should not redirect"); },
  };
  await withFetch(async () => { throw new Error("offline"); }, async () => {
    await new Promise((resolve, reject) => {
      handler({ query: { q: "birthday cake", w: "400", h: "300" } }, { ...res, send(body) { sent = body; resolve(); } }, reject);
    });
  });
  assert.equal(type, "image/svg+xml");
  assert.match(sent, /^<svg /);
  assert.equal(headers["Cache-Control"], "public, max-age=300");
});
