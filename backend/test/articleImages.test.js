const test = require("node:test");
const assert = require("node:assert/strict");
const { extractImageFromHtml, findArticleImage, fillMissingImages, isPrivateAddress, _cache } = require("../src/services/articleImages");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const htmlResponse = (html, status = 200, headers = {}) => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

test("extractImageFromHtml prefers og:image and resolves relative URLs", () => {
  const html = `<html><head>
    <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    <meta content="/img/lead.jpg?w=1200&amp;h=630" property="og:image">
  </head></html>`;
  assert.equal(extractImageFromHtml(html, "https://news.example.com/story/1"), "https://news.example.com/img/lead.jpg?w=1200&h=630");
});

test("extractImageFromHtml falls back to twitter:image and image_src, and ignores non-http", () => {
  assert.equal(extractImageFromHtml('<meta name="twitter:image:src" content="https://a.b/t.png">', "https://x.y/"), "https://a.b/t.png");
  assert.equal(extractImageFromHtml('<link rel="image_src" href="//cdn.x.y/p.jpg">', "https://x.y/a"), "https://cdn.x.y/p.jpg");
  assert.equal(extractImageFromHtml('<meta property="og:image" content="javascript:alert(1)">', "https://x.y/"), null);
  assert.equal(extractImageFromHtml("<p>no tags</p>", "https://x.y/"), null);
});

test("isPrivateAddress blocks internal ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress("93.184.216.34"), false);
});

test("findArticleImage refuses private hosts without fetching", async () => {
  _cache.clear();
  let fetched = false;
  const image = await findArticleImage("http://internal.test/a", {
    lookup: async () => [{ address: "10.0.0.5", family: 4 }],
    fetchImpl: async () => { fetched = true; return htmlResponse(""); },
  });
  assert.equal(image, null);
  assert.equal(fetched, false);
});

test("findArticleImage follows a redirect and re-checks the target host", async () => {
  _cache.clear();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === "https://short.example/x") return new Response(null, { status: 301, headers: { location: "https://news.example/story" } });
    return htmlResponse('<head><meta property="og:image" content="https://cdn.news.example/p.jpg"></head>');
  };
  assert.equal(await findArticleImage("https://short.example/x", { fetchImpl, lookup: publicLookup }), "https://cdn.news.example/p.jpg");
  assert.deepEqual(calls, ["https://short.example/x", "https://news.example/story"]);

  _cache.clear();
  const toPrivate = async (url) => url.includes("short")
    ? new Response(null, { status: 302, headers: { location: "http://metadata.internal/" } })
    : htmlResponse('<meta property="og:image" content="https://evil/p.jpg">');
  const lookup = async (host) => [{ address: host === "metadata.internal" ? "169.254.169.254" : "93.184.216.34", family: 4 }];
  assert.equal(await findArticleImage("https://short.example/y", { fetchImpl: toPrivate, lookup }), null);
});

test("fillMissingImages fills only missing images and respects the time budget", async () => {
  _cache.clear();
  const articles = [
    { link: "https://a.example/1", image_url: "https://keep/me.jpg" },
    { link: "https://a.example/2", image_url: null },
    { link: "https://slow.example/3", image_url: null },
  ];
  const fetchImpl = async (url) => {
    if (url.includes("slow")) await new Promise((r) => setTimeout(r, 1000));
    return htmlResponse('<meta property="og:image" content="https://cdn.a.example/2.jpg">');
  };
  const started = Date.now();
  await fillMissingImages(articles, { fetchImpl, lookup: publicLookup, budgetMs: 200 });
  assert.ok(Date.now() - started < 800, "returns within the budget");
  assert.equal(articles[0].image_url, "https://keep/me.jpg");
  assert.equal(articles[1].image_url, "https://cdn.a.example/2.jpg");
  assert.equal(articles[2].image_url, null);
});

test("GET /api/news/preview-image rejects missing or non-http URLs", async (t) => {
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/news/preview-image`;

  assert.equal((await fetch(base)).status, 400);
  assert.equal((await fetch(`${base}?url=${encodeURIComponent("file:///etc/passwd")}`)).status, 400);
  const local = await fetch(`${base}?url=${encodeURIComponent("http://127.0.0.1:1/")}`);
  assert.equal(local.status, 200);
  assert.deepEqual(await local.json(), { image_url: null }, "private hosts are never fetched");
});

// A site that blocks our fetch (403) — Firecrawl's scraper gets the photo.
function blockedSiteWithFirecrawl(image, calls) {
  return async (url, opts = {}) => {
    calls.push(url);
    if (url === "https://api.firecrawl.dev/v2/scrape") {
      assert.equal(opts.headers.Authorization, "Bearer fc-test");
      assert.equal(JSON.parse(opts.body).url, "https://blocked.example/story");
      return new Response(JSON.stringify({ success: true, data: { metadata: { ogImage: image } } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("Forbidden", { status: 403, headers: { "content-type": "text/html" } });
  };
}
const anyPublicLookup = async () => [{ address: "93.184.216.34" }];

test("an article that blocks our fetch gets its photo through Firecrawl", async () => {
  _cache.clear();
  const calls = [];
  const fetchImpl = blockedSiteWithFirecrawl("https://cdn.blocked.example/photo.jpg", calls);
  const image = await findArticleImage("https://blocked.example/story", { fetchImpl, lookup: anyPublicLookup, firecrawlApiKey: "fc-test" });
  assert.equal(image, "https://cdn.blocked.example/photo.jpg");
  assert.deepEqual(calls, ["https://blocked.example/story", "https://api.firecrawl.dev/v2/scrape"]);
});

test("Firecrawl is not used without a key, nor for private hosts", async () => {
  _cache.clear();
  const calls = [];
  const fetchImpl = blockedSiteWithFirecrawl("https://cdn.blocked.example/photo.jpg", calls);
  assert.equal(await findArticleImage("https://blocked.example/story", { fetchImpl, lookup: anyPublicLookup, firecrawlApiKey: "" }), null);
  _cache.clear();
  assert.equal(await findArticleImage("http://10.0.0.5/story", { fetchImpl, lookup: anyPublicLookup, firecrawlApiKey: "fc-test" }), null);
  assert.ok(!calls.includes("https://api.firecrawl.dev/v2/scrape"));
});

test("two lookups of the same article share one Firecrawl call", async () => {
  _cache.clear();
  const calls = [];
  const fetchImpl = blockedSiteWithFirecrawl("https://cdn.blocked.example/photo.jpg", calls);
  const opts = { fetchImpl, lookup: anyPublicLookup, firecrawlApiKey: "fc-test" };
  const [a, b] = await Promise.all([findArticleImage("https://blocked.example/story", opts), findArticleImage("https://blocked.example/story", opts)]);
  assert.equal(a, b);
  assert.equal(calls.filter((u) => u.includes("firecrawl")).length, 1);
});
