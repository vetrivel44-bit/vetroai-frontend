const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectNewsProvider,
  resolveCategory,
  buildNewsRequest,
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
  for (const provider of ["newsdata", "thenewsapi", "newsapi"]) {
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

// An error body, or a plan that returns nothing, must not crash the panel.
test("a payload with no articles normalizes to an empty list", () => {
  for (const provider of ["newsdata", "thenewsapi", "newsapi"]) {
    assert.deepEqual(normalizeNewsPayload(provider, {}), []);
    assert.deepEqual(normalizeNewsPayload(provider, { results: null, data: null, articles: null }), []);
  }
});
