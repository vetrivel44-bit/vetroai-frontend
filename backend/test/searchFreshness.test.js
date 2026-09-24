const test = require("node:test");
const assert = require("node:assert/strict");

const { detectFreshness, sortByRecency } = require("../src/services/searchFreshness");
const { searchKeyless } = require("../src/controllers/searchController");

const NOW = new Date("2026-09-24T12:00:00Z");

test("time-sensitive queries get a recency window", () => {
  assert.equal(detectFreshness("india vs australia score today", NOW).timeRange, "day");
  assert.equal(detectFreshness("latest iPhone launch", NOW).timeRange, "week");
  assert.equal(detectFreshness("AI news", NOW).topic, "news");
  assert.equal(detectFreshness("best laptops 2026", NOW).timeRange, "year");
  assert.equal(detectFreshness("gold rate in chennai", NOW).timeRange, "day");
});

test("timeless queries stay unrestricted", () => {
  for (const q of ["how does photosynthesis work", "react vs vue", "create a new react app", "normal heart rate"]) {
    const f = detectFreshness(q, NOW);
    assert.equal(f.timeRange, null, q);
    assert.equal(f.recent, false, q);
  }
});

test("sortByRecency puts the newest dated results first and keeps undated ones after", () => {
  const sorted = sortByRecency([
    { url: "a", published_date: "2024-01-01" },
    { url: "b" },
    { url: "c", published: "2026-09-23T10:00:00Z" },
    { url: "d", publishedDate: "2025-06-01" },
  ]);
  assert.deepEqual(sorted.map((r) => r.url), ["c", "d", "a", "b"]);
});

test("keyless search sends a time-sensitive query to Google News inside its window", async (t) => {
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    seen.push(String(url));
    if (String(url).startsWith("https://news.google.com/rss/search")) {
      return new Response(`<rss><channel>
        <item><title>Older report</title><link>https://example.com/old</link><pubDate>Mon, 21 Sep 2026 09:00:00 GMT</pubDate></item>
        <item><title>Newest report</title><link>https://example.com/new</link><pubDate>Thu, 24 Sep 2026 09:00:00 GMT</pubDate></item>
      </channel></rss>`, { status: 200 });
    }
    return new Response("", { status: 503 });
  };
  t.after(() => { global.fetch = realFetch; });

  const { provider, results } = await searchKeyless("latest cricket news");
  assert.equal(provider, "google-news");
  assert.ok(decodeURIComponent(seen[0]).includes("when:7d"), seen[0]);
  assert.equal(results[0].title, "Newest report");
});
