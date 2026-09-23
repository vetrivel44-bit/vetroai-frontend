const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const { parseRssItems } = require("../src/controllers/searchController");

const bingRss = `<?xml version="1.0"?><rss><channel><title>Bing: ai news</title>
<item><title>AI chips &amp; phones</title><link>https://tech.example/chips</link><description>Chipmakers unveiled &lt;b&gt;new&lt;/b&gt; parts.</description><pubDate>Tue, 23 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>No link item</title><description>skip me</description></item>
</channel></rss>`;

const googleNewsRss = `<rss><channel><item><title><![CDATA[India wins series - The Hindu]]></title><link>https://news.google.com/rss/articles/abc</link><pubDate>Tue, 23 Sep 2026 09:00:00 GMT</pubDate><source url="https://thehindu.com">The Hindu</source></item></channel></rss>`;

test("parseRssItems reads Bing and Google News feeds", () => {
  const bing = parseRssItems(bingRss);
  assert.equal(bing.length, 1);
  assert.equal(bing[0].title, "AI chips & phones");
  assert.equal(bing[0].url, "https://tech.example/chips");
  assert.equal(bing[0].description, "Chipmakers unveiled new parts.");
  assert.equal(bing[0].published, "2026-09-23T10:00:00.000Z");

  const news = parseRssItems(googleNewsRss);
  assert.equal(news[0].title, "India wins series - The Hindu");
  assert.equal(news[0].source, "The Hindu");
});

test("POST /api/web-search falls back to keyless search when Tavily is not configured", async (t) => {
  const savedKey = config.tavilyApiKey;
  const savedEnv = process.env.TAVILY_API_KEY;
  config.tavilyApiKey = "";
  delete process.env.TAVILY_API_KEY;
  const realFetch = global.fetch;
  // DuckDuckGo goes through its own client; Bing RSS through fetch.
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://www.bing.com/search?format=rss")) {
      return new Response(bingRss, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    if (String(url).startsWith("http://127.0.0.1")) return realFetch(url, opts);
    return new Response("", { status: 503 });
  };
  t.after(() => { global.fetch = realFetch; config.tavilyApiKey = savedKey; if (savedEnv) process.env.TAVILY_API_KEY = savedEnv; });

  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const res = await realFetch(`http://127.0.0.1:${server.address().port}/api/web-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "ai news" }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(["bing", "duckduckgo"].includes(body.data.provider));
  assert.ok(body.data.results.length >= 1);
  assert.ok(body.data.results[0].url.startsWith("https://"));
});
