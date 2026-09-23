const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectNewsProvider,
  toIsoDate,
  resolveCategory,
  buildNewsRequest,
  buildNewsAuthFallback,
  normalizeNewsPayload,
} = require("../src/services/newsProviders");

// ── Which service does a key belong to ───────────────────────────────────────
// The feed was newsdata.io-only, so a key for any other service was sent to
// newsdata's endpoint with newsdata's parameter names and came back 401.
test("a pub_ key is newsdata.io", () => {
  assert.equal(detectNewsProvider("pub_0123456789abcdef"), "newsdata");
});

test("a 40-character alphanumeric token is thenewsapi.com", () => {
  assert.equal(detectNewsProvider("EXAMPLE40charAlphanumericTokenShapeAaBbX"), "thenewsapi");
});

test("a 48-character token is currentsapi.services", () => {
  assert.equal(detectNewsProvider("EXAMPLE48charCurrentsStyleTokenShapeAaBbCcDdEeFf"), "currents");
});

test("a 32-character hex key is newsapi.org", () => {
  assert.equal(detectNewsProvider("0123456789abcdef0123456789abcdef"), "newsapi");
});

test("an explicit NEWS_PROVIDER overrides detection", () => {
  assert.equal(detectNewsProvider("pub_abc", "thenewsapi"), "thenewsapi");
  assert.equal(detectNewsProvider("EXAMPLE40charAlphanumericTokenShapeAaBbX", "newsdata"), "newsdata");
});

test("an unknown NEWS_PROVIDER falls back to detection", () => {
  assert.equal(detectNewsProvider("pub_abc", "not-a-service"), "newsdata");
});

test("no key means no provider", () => {
  assert.equal(detectNewsProvider(""), null);
  assert.equal(detectNewsProvider(null, "newsdata"), "newsdata");
});

// ── Category vocabulary ──────────────────────────────────────────────────────
test("top means no category filter everywhere", () => {
  for (const provider of ["newsdata", "thenewsapi", "newsapi", "currents"]) {
    assert.equal(resolveCategory(provider, "top"), "");
  }
});

test("technology is spelled tech on thenewsapi", () => {
  assert.equal(resolveCategory("thenewsapi", "technology"), "tech");
  assert.equal(resolveCategory("newsdata", "technology"), "technology");
  assert.equal(resolveCategory("newsapi", "technology"), "technology");
});

// newsapi.org has no politics category, and sending one is a 400.
test("a category the provider lacks is dropped, not sent", () => {
  assert.equal(resolveCategory("newsapi", "politics"), "");
  assert.equal(resolveCategory("thenewsapi", "politics"), "politics");
});

// ── Request building ─────────────────────────────────────────────────────────
test("thenewsapi headlines use /news/top with api_token", () => {
  const { url } = buildNewsRequest("thenewsapi", {
    apiKey: "TOKEN", query: "", category: "technology", language: "en",
  });
  assert.match(url, /^https:\/\/api\.thenewsapi\.com\/v1\/news\/top\?/);
  const params = new URL(url).searchParams;
  assert.equal(params.get("api_token"), "TOKEN");
  assert.equal(params.get("categories"), "tech");
  assert.equal(params.get("language"), "en");
  // Plan-capped, so absent unless configured.
  assert.equal(params.get("limit"), null);
});

test("thenewsapi search uses /news/all with search, not a category", () => {
  const { url } = buildNewsRequest("thenewsapi", {
    apiKey: "TOKEN", query: "chennai floods", category: "technology", language: "en", limit: 3,
  });
  assert.match(url, /^https:\/\/api\.thenewsapi\.com\/v1\/news\/all\?/);
  const params = new URL(url).searchParams;
  assert.equal(params.get("search"), "chennai floods");
  assert.equal(params.get("categories"), null);
  assert.equal(params.get("limit"), "3");
});

test("newsapi.org sends the key as a header, never in the query", () => {
  const { url, headers } = buildNewsRequest("newsapi", {
    apiKey: "SECRET", query: "", category: "business", language: "en",
  });
  assert.equal(headers["X-Api-Key"], "SECRET");
  assert.ok(!url.includes("SECRET"));
});

test("newsdata keeps the original endpoint and parameter names", () => {
  const { url } = buildNewsRequest("newsdata", {
    apiKey: "pub_x", query: "", category: "sports", language: "en",
  });
  assert.match(url, /^https:\/\/newsdata\.io\/api\/1\/latest\?/);
  const params = new URL(url).searchParams;
  assert.equal(params.get("apikey"), "pub_x");
  assert.equal(params.get("category"), "sports");
});

test("an unknown provider is rejected rather than guessed at", () => {
  assert.throws(() => buildNewsRequest("nope", { apiKey: "x" }), /Unknown news provider/);
});

// ── Response normalizing ─────────────────────────────────────────────────────
// The panel renders article_id / title / description / link / image_url /
// source_name / pubDate. Anything missing shows as a blank card.
test("a thenewsapi article maps onto the shape the panel renders", () => {
  const [article] = normalizeNewsPayload("thenewsapi", {
    data: [{
      uuid: "abc-123",
      title: "Headline",
      description: "Summary",
      snippet: "Fallback text",
      url: "https://example.com/story",
      image_url: "https://example.com/story.jpg",
      source: "example.com",
      published_at: "2026-09-17T10:15:00.000000Z",
    }],
  });
  assert.deepEqual(article, {
    article_id: "abc-123",
    title: "Headline",
    description: "Summary",
    link: "https://example.com/story",
    image_url: "https://example.com/story.jpg",
    source_name: "example.com",
    source_id: "example.com",
    source_icon: null,
    pubDate: "2026-09-17T10:15:00.000000Z",
  });
});

test("thenewsapi falls back to the snippet when there is no description", () => {
  const [article] = normalizeNewsPayload("thenewsapi", {
    data: [{ title: "T", snippet: "Fallback text", url: "https://example.com" }],
  });
  assert.equal(article.description, "Fallback text");
});

test("a newsapi.org article maps onto the same shape", () => {
  const [article] = normalizeNewsPayload("newsapi", {
    articles: [{
      title: "Headline",
      description: "Summary",
      url: "https://example.com/story",
      urlToImage: "https://example.com/story.jpg",
      source: { id: "the-verge", name: "The Verge" },
      publishedAt: "2026-09-17T10:15:00Z",
    }],
  });
  assert.equal(article.source_name, "The Verge");
  assert.equal(article.image_url, "https://example.com/story.jpg");
  assert.equal(article.pubDate, "2026-09-17T10:15:00Z");
  assert.equal(article.link, "https://example.com/story");
});

test("newsdata articles pass through untouched", () => {
  const original = [{ article_id: "1", title: "T", link: "https://example.com" }];
  assert.deepEqual(normalizeNewsPayload("newsdata", { results: original }), original);
});

// ── Currents API ─────────────────────────────────────────────────────────────
test("currents headlines use /latest-news with a Bearer token header", () => {
  const { url, headers } = buildNewsRequest("currents", {
    apiKey: "SECRET", query: "", category: "technology", language: "en",
  });
  assert.match(url, /^https:\/\/api\.currentsapi\.services\/v1\/latest-news\?/);
  assert.equal(headers.Authorization, "Bearer SECRET");
  assert.ok(!url.includes("SECRET"));
  const params = new URL(url).searchParams;
  assert.equal(params.get("category"), "technology");
  assert.equal(params.get("language"), "en");
  assert.equal(params.get("page_size"), null);
});

test("currents search uses /search with keywords", () => {
  const { url } = buildNewsRequest("currents", {
    apiKey: "SECRET", query: "chennai floods", category: "top", language: "en", limit: 20,
  });
  assert.match(url, /^https:\/\/api\.currentsapi\.services\/v1\/search\?/);
  const params = new URL(url).searchParams;
  assert.equal(params.get("keywords"), "chennai floods");
  assert.equal(params.get("page_size"), "20");
});

// Currents' docs have shown a bare Authorization header, a Bearer one and an
// `apiKey` parameter at different times. A 401 on the first form is retried
// once on the other rather than making the operator guess which their account
// wants.
test("currents falls back to the apiKey parameter", () => {
  const params = { apiKey: "SECRET", query: "", category: "top", language: "en" };
  const request = buildNewsRequest("currents", params);
  const fallback = buildNewsAuthFallback("currents", params, request);
  const search = new URL(fallback.url).searchParams;
  assert.equal(search.get("apiKey"), "SECRET");
  assert.equal(search.get("language"), "en");
  assert.deepEqual(fallback.headers, {});
  // The original request is not mutated by building the fallback.
  assert.equal(request.headers.Authorization, "Bearer SECRET");
});

test("a fallback keeps the endpoint and query it was built from", () => {
  const params = { apiKey: "SECRET", query: "floods", category: "top", language: "en" };
  const fallback = buildNewsAuthFallback("currents", params, buildNewsRequest("currents", params));
  assert.match(fallback.url, /\/v1\/search\?/);
  assert.equal(new URL(fallback.url).searchParams.get("keywords"), "floods");
});

test("providers with one auth form have no fallback", () => {
  for (const provider of ["newsdata", "thenewsapi", "newsapi"]) {
    const params = { apiKey: "K", query: "", category: "top", language: "en" };
    assert.equal(buildNewsAuthFallback(provider, params, buildNewsRequest(provider, params)), null);
  }
});

test("a currents article maps onto the shape the panel renders", () => {
  const [article] = normalizeNewsPayload("currents", {
    news: [{
      id: "cur-1",
      title: "Headline",
      description: "Summary",
      url: "https://www.example.com/story",
      image: "https://example.com/story.jpg",
      published: "2026-09-17 12:00:00 +0000",
    }],
  });
  assert.equal(article.article_id, "cur-1");
  assert.equal(article.link, "https://www.example.com/story");
  assert.equal(article.image_url, "https://example.com/story.jpg");
  // Currents names no outlet, so the link's host stands in for one.
  assert.equal(article.source_name, "example.com");
});

// The bug this guards: the panel's timeAgo() turns an offset timestamp into an
// invalid Date, so every card read "NaNm" instead of "5m".
test("a currents timestamp is converted to something timeAgo can parse", () => {
  const [article] = normalizeNewsPayload("currents", {
    news: [{ title: "T", url: "https://example.com", published: "2026-09-17 12:00:00 +0000" }],
  });
  assert.equal(article.pubDate, "2026-09-17T12:00:00.000Z");
  assert.ok(!Number.isNaN(new Date(article.pubDate).getTime()));
});

test("a non-UTC offset is converted to the right instant", () => {
  assert.equal(toIsoDate("2026-09-17 12:00:00 +05:30"), "2026-09-17T06:30:00.000Z");
  assert.equal(toIsoDate("2026-09-17 12:00:00 -0400"), "2026-09-17T16:00:00.000Z");
});

test("timestamps the panel already handles are left alone", () => {
  assert.equal(toIsoDate("2026-09-17T12:00:00Z"), "2026-09-17T12:00:00Z");
  assert.equal(toIsoDate("2026-09-17 12:00:00"), "2026-09-17 12:00:00");
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate(null), null);
});

// Currents sends the literal string "None" when an article has no image.
test('currents "None" image becomes no image at all', () => {
  const [article] = normalizeNewsPayload("currents", {
    news: [{ title: "T", url: "https://example.com", image: "None" }],
  });
  assert.equal(article.image_url, null);
});

// An error body, or a plan that returns nothing, must not crash the panel.
test("a payload with no articles normalizes to an empty list", () => {
  for (const provider of ["newsdata", "thenewsapi", "newsapi", "currents"]) {
    assert.deepEqual(normalizeNewsPayload(provider, {}), []);
    assert.deepEqual(normalizeNewsPayload(provider, { results: null, data: null, articles: null, news: null }), []);
  }
});

test("each provider pages: request carries the cursor and nextPage reads the response", () => {
  const { buildNewsRequest, nextNewsPage } = require("../src/services/newsProviders");
  const base = { apiKey: "k", query: "", category: "top", language: "en", limit: 0 };

  assert.match(buildNewsRequest("newsdata", { ...base, page: "abc123" }).url, /[?&]page=abc123/);
  assert.equal(nextNewsPage("newsdata", { nextPage: "abc124" }, "abc123"), "abc124");
  assert.equal(nextNewsPage("newsdata", { results: [] }, "abc123"), null);

  assert.match(buildNewsRequest("thenewsapi", { ...base, page: "2" }).url, /[?&]page=2/);
  assert.equal(nextNewsPage("thenewsapi", { meta: { found: 30, returned: 3, limit: 3, page: 2 }, data: [1, 2, 3] }, "2"), "3");
  assert.equal(nextNewsPage("thenewsapi", { meta: { found: 6, returned: 3, limit: 3, page: 2 }, data: [1, 2, 3] }, "2"), null);

  assert.match(buildNewsRequest("newsapi", { ...base, page: "3" }).url, /[?&]page=3/);
  assert.equal(nextNewsPage("newsapi", { totalResults: 100, articles: new Array(20).fill({}) }, "1"), "2");
  assert.equal(nextNewsPage("newsapi", { totalResults: 40, articles: new Array(20).fill({}) }, "2"), null);

  assert.match(buildNewsRequest("currents", { ...base, page: "4" }).url, /[?&]page_number=4/);
  assert.equal(nextNewsPage("currents", { news: [{}] }, "4"), "5");
  assert.equal(nextNewsPage("currents", { news: [] }, "4"), null);

  // No page on the first request.
  assert.doesNotMatch(buildNewsRequest("newsdata", base).url, /[?&]page=/);
});

test("requests ask for recent news and results are sorted newest first", () => {
  const { buildNewsRequest, sortNewestFirst } = require("../src/services/newsProviders");
  const now = Date.parse("2026-09-23T12:00:00Z");
  const base = { apiKey: "k", category: "top", language: "en", limit: 0, now };

  const newsapiSearch = new URL(buildNewsRequest("newsapi", { ...base, query: "floods" }).url);
  assert.equal(newsapiSearch.searchParams.get("sortBy"), "publishedAt");
  assert.equal(newsapiSearch.searchParams.get("from"), "2026-09-20T12:00:00");

  const tnaTop = new URL(buildNewsRequest("thenewsapi", { ...base, query: "" }).url);
  assert.equal(tnaTop.searchParams.get("published_after"), "2026-09-20T12:00:00");
  const tnaSearch = new URL(buildNewsRequest("thenewsapi", { ...base, query: "ai" }).url);
  assert.equal(tnaSearch.searchParams.get("sort"), "published_at");

  const currentsSearch = new URL(buildNewsRequest("currents", { ...base, query: "ai" }).url);
  assert.equal(currentsSearch.searchParams.get("start_date"), "2026-09-20T12:00:00+00:00");

  const sorted = sortNewestFirst([
    { title: "old", pubDate: "2026-09-21 08:00:00" },
    { title: "undated" },
    { title: "new", pubDate: "2026-09-23T11:00:00Z" },
    { title: "mid", pubDate: "2026-09-22T10:00:00+05:30" },
  ]);
  assert.deepEqual(sorted.map((a) => a.title), ["new", "mid", "old", "undated"]);
});

test("dedupeArticles drops repeated stories under different ids, links and headline tails", () => {
  const { dedupeArticles, linkKey, headlineKey } = require("../src/services/newsProviders");
  assert.equal(linkKey("https://www.site.com/story/amp/?utm_source=x&id=7"), linkKey("https://site.com/story?id=7"));
  assert.equal(headlineKey("India beats Australia by 5 wickets - The Hindu"), headlineKey("India beats Australia by 5 wickets | NDTV Sports"));

  const out = dedupeArticles([
    { article_id: "1", title: "India beats Australia by 5 wickets in thrilling chase - The Hindu", link: "https://thehindu.com/a", image_url: null },
    { article_id: "2", title: "India beats Australia by 5 wickets in thrilling chase | NDTV", link: "https://ndtv.com/b", image_url: "https://img/p.jpg" },
    { article_id: "3", title: "Different story entirely about monsoon rains", link: "https://www.thehindu.com/a/?utm_source=feed" },
    { article_id: "4", title: "India beat Australia by five wickets in thrilling chase", link: "https://espn.com/c" },
    { article_id: "5", title: "RBI keeps repo rate unchanged at 6.5 percent", link: "https://mint.com/r" },
    { article_id: "6", title: "Flagged by the provider", link: "https://x.com/d", duplicate: true },
  ]);
  // 2: same headline minus the outlet; 3: same link minus tracking/www;
  // 4: reworded ("beat … five" vs "beats … 5"); 6: flagged by the provider.
  assert.deepEqual(out.map((a) => a.article_id), ["1", "5"]);
  assert.equal(out[0].image_url, "https://img/p.jpg", "kept copy borrows the duplicate's picture");
});
