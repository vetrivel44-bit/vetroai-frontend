const test = require("node:test");
const assert = require("node:assert/strict");

// Keep incumbent network calls deterministic while exercising their normal
// resolver. Each test file runs in its own process under node --test.
const tavilyCalls = [];
const ddgCalls = [];
require("@tavily/core");
require.cache[require.resolve("@tavily/core")].exports = { tavily: ({ apiKey }) => ({
  search: async (query, options) => {
    tavilyCalls.push({ apiKey, query, options });
    return { results: [{ url: "https://legacy.test/tavily", title: "Tavily", content: "Saved key selected" }] };
  },
}) };
require("duck-duck-scrape");
require.cache[require.resolve("duck-duck-scrape")].exports = { search: async (query) => {
  ddgCalls.push(query);
  return { results: [{ url: "https://legacy.test/ddg", title: "DuckDuckGo", description: "Keyless default" }] };
} };

const { config } = require("../src/config/env");
const { searchWeb, searchForResearch, searchImages, resolveSearchProvider } = require("../src/controllers/searchController");
const { performAgenticSearch } = require("../src/services/agenticSearchService");
const { ENDPOINT, USER_AGENT } = require("../src/services/parallelSearchService");

const RESULT = { url: "https://example.com/research", title: "Solar cost research", publish_date: "2026-10-01", excerpts: ["Solar cost evidence with a source.", "A second relevant passage."] };
const json = (id, result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
  headers: { "Content-Type": "application/json", "Mcp-Session-Id": "fixture-session" },
});

function setup(t, { provider = "parallel", hang, error, status, textOnly, malformed, results = [RESULT] } = {}) {
  const saved = { provider: config.webSearchProvider, key: config.tavilyApiKey, envKey: process.env.TAVILY_API_KEY, fetch: global.fetch };
  config.webSearchProvider = provider;
  config.tavilyApiKey = "";
  delete process.env.TAVILY_API_KEY;
  tavilyCalls.length = 0;
  ddgCalls.length = 0;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    assert.equal(String(url), ENDPOINT, "only the fixed MCP endpoint is contacted");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("User-Agent"), USER_AGENT);
    assert.equal(headers.get("Authorization"), null, "anonymous even with ambient provider credentials");
    assert.equal(headers.get("x-api-key"), null);
    assert.ok(init.signal instanceof AbortSignal);
    if (init.method === "GET") return new Response(null, { status: 405 });
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.method === hang) {
      return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    }
    if (body.method === "initialize") return json(body.id, {
      protocolVersion: body.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: "parallel-fixture", version: "1.0" },
    });
    if (!body.id) return new Response(null, { status: 202 });
    assert.equal(headers.get("Mcp-Session-Id"), "fixture-session");
    if (body.method === "tools/list") return json(body.id, {
      tools: [{ name: "web_search", inputSchema: { type: "object" } }],
    });
    assert.equal(body.method, "tools/call");
    assert.equal(body.params.name, "web_search");
    assert.deepEqual(body.params.arguments.search_queries, [body.params.arguments.objective]);
    assert.match(body.params.arguments.session_id, /^[a-f0-9-]{36}$/);
    if (status) return new Response("provider unavailable", { status });
    const data = { search_id: "search_fixture", session_id: body.params.arguments.session_id, results };
    return json(body.id, error ? { isError: true, content: [{ type: "text", text: "Quota exceeded" }] }
      : malformed ? { content: [{ type: "text", text: "not valid JSON" }] }
        : textOnly ? { content: [{ type: "text", text: JSON.stringify(data) }] }
          : { content: [], structuredContent: data });
  };
  t.after(() => {
    config.webSearchProvider = saved.provider;
    config.tavilyApiKey = saved.key;
    global.fetch = saved.fetch;
    if (saved.envKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = saved.envKey;
  });
  return calls;
}

test("Web Search consumes anonymous MCP URLs, dates and excerpts", async (t) => {
  const calls = setup(t);
  const reply = await searchWeb("solar cost evidence");
  assert.equal(reply.results[0].url, RESULT.url);
  assert.equal(reply.results[0].published, RESULT.publish_date);
  assert.match(reply.context, /Solar cost evidence with a source/);
  assert.ok(reply.context.includes(RESULT.url));
  assert.ok(calls.some((c) => c.method === "initialize"));
  assert.ok(calls.some((c) => c.method === "tools/list"));
  assert.equal(tavilyCalls.length + ddgCalls.length, 0);
});

test("normal DeepSearch loop assembles MCP sources and reuses its session", async (t) => {
  const calls = setup(t);
  const reply = await performAgenticSearch("solar cost evidence", {
    plannerFn: async () => JSON.stringify({ angles: [{ question: "Costs", queries: ["solar cost comparisons"] }] }),
    maxRounds: 1, verifyClaims: 0, readPages: 0,
  });
  assert.equal(reply.results[0].url, RESULT.url);
  assert.match(reply.context, /Solar cost evidence with a source/);
  assert.match(reply.context, /\[1\]/);
  const searches = calls.filter((c) => c.method === "tools/call");
  assert.equal(searches.length, 2);
  assert.equal(new Set(searches.map((c) => c.params.arguments.session_id)).size, 1);
});

test("the unconfigured default and configured Tavily key keep their existing routes", async (t) => {
  setup(t, { provider: "auto" });
  assert.equal(resolveSearchProvider(), "auto");
  assert.equal((await searchForResearch("solar costs explained"))[0].url, "https://legacy.test/ddg");
  assert.equal(ddgCalls.length, 1);
  config.tavilyApiKey = "saved-tavily-key";
  assert.equal((await searchForResearch("solar costs explained"))[0].url, "https://legacy.test/tavily");
  assert.equal(tavilyCalls[0].apiKey, "saved-tavily-key");
  config.webSearchProvider = "parallel";
  assert.equal((await searchForResearch("solar costs explained"))[0].url, RESULT.url);
  assert.equal(tavilyCalls.length, 1, "explicit Parallel selection overrides the saved key intentionally");
  assert.equal((await searchForResearch("solar costs explained", { provider: "auto" }))[0].url, "https://legacy.test/tavily");
});

test("disabled search, request overrides and invalid configuration make no MCP calls", async (t) => {
  const calls = setup(t, { provider: "none" });
  config.tavilyApiKey = "saved-key";
  assert.deepEqual(await searchForResearch("anything"), []);
  assert.deepEqual((await searchWeb("anything")).results, []);
  assert.deepEqual(await searchImages("anything"), []);
  config.webSearchProvider = "parallel";
  assert.deepEqual(await searchForResearch("anything", { provider: "none" }), []);
  await assert.rejects(searchForResearch("anything", { provider: "typo" }), /WEB_SEARCH_PROVIDER/);
  assert.equal(calls.length + tavilyCalls.length + ddgCalls.length, 0);
});

test("text JSON replies work; unsafe URL schemes and embedded credentials are excluded", async (t) => {
  setup(t, { textOnly: true, results: [RESULT, { ...RESULT, url: "javascript:alert(1)" },
    { ...RESULT, url: "file:///etc/passwd" }, { ...RESULT, url: "https://user:secret@example.com" },
    { ...RESULT, url: "not a URL" }] });
  const results = await searchForResearch("solar costs");
  assert.equal(results.length, 1);
  assert.equal(results[0].text, "", "excerpts are not misrepresented as full-page text");
});

test("DeepSearch keeps its existing public-host page-reading restriction", async (t) => {
  setup(t, { results: [{ ...RESULT, url: "http://127.0.0.1/private" }] });
  let connections = 0;
  t.mock.method(require("node:http"), "request", () => {
    connections++;
    throw new Error("Private host must not be contacted");
  });
  const reply = await performAgenticSearch("solar cost evidence", { plannerFn: null, maxRounds: 1 });
  assert.equal(reply.results.length, 1);
  assert.match(reply.context, /Solar cost evidence/);
  assert.equal(connections, 0);
});

test("an empty Parallel response stays empty without invoking an incumbent", async (t) => {
  setup(t, { results: [] });
  assert.deepEqual((await searchWeb("solar costs")).results, []);
  assert.equal(tavilyCalls.length + ddgCalls.length, 0);
});

test("selecting Parallel does not grant a normal chat turn permission to search", async (t) => {
  const calls = setup(t);
  const orchestrator = require("../src/services/AIOrchestrator");
  const providers = require("../src/services/ProviderManager");
  const adapter = { generateStream: async () => (async function* () {
    yield 'data: {"choices":[{"delta":{"content":"A photovoltaic cell converts light into electricity."}}]}\n';
  })() };
  t.mock.method(providers, "getBestProvider", () => "fixture");
  t.mock.method(providers, "getAvailableProviders", () => ["fixture"]);
  t.mock.method(providers, "getAdapter", () => adapter);
  t.mock.method(providers, "isConfigured", (name) => name === "fixture");
  t.mock.method(providers, "updateMetrics", () => {});
  const answered = await orchestrator.processRequest("search-permission", {
    messages: [{ role: "user", content: "How do photovoltaic cells work?" }],
    mode: "normal", webSearch: false, options: {},
  }, { write: () => {}, end: () => {}, writableEnded: false });
  assert.equal(answered, true);
  assert.equal(calls.length + tavilyCalls.length + ddgCalls.length, 0);
});

for (const options of [{ error: true }, { status: 429 }, { status: 503 }, { malformed: true }]) {
  test(`Parallel errors do not silently switch providers: ${JSON.stringify(options)}`, async (t) => {
    setup(t, options);
    config.tavilyApiKey = "saved-key";
    await assert.rejects(searchForResearch("solar costs"));
    assert.equal(tavilyCalls.length + ddgCalls.length, 0);
  });
}

for (const hang of ["initialize", "tools/list", "tools/call"]) {
  test(`timeout covers MCP ${hang}`, async (t) => {
    setup(t, { hang });
    await assert.rejects(searchForResearch("solar costs", { timeoutMs: 30 }), /timed out|aborted/i);
    assert.equal(tavilyCalls.length + ddgCalls.length, 0);
  });
}

test("cancellation stops in-flight MCP and pre-cancelled research starts no requests", async (t) => {
  const calls = setup(t, { hang: "tools/call" });
  const cancel = new AbortController();
  const pending = searchWeb("solar costs", { signal: cancel.signal });
  const timer = setTimeout(() => cancel.abort(), 30);
  await assert.rejects(pending, /aborted/i);
  clearTimeout(timer);
  assert.ok(calls.some((c) => c.method === "tools/call"));
  const before = calls.length;
  await performAgenticSearch("solar costs", { signal: cancel.signal, plannerFn: null });
  assert.equal(calls.length, before);
});

test("cancelling the normal DeepSearch caller aborts its active search", async (t) => {
  const calls = setup(t, { hang: "tools/call" });
  const cancel = new AbortController();
  const pending = performAgenticSearch("solar costs", { signal: cancel.signal, plannerFn: null });
  const timer = setTimeout(() => cancel.abort(), 30);
  const reply = await pending;
  clearTimeout(timer);
  assert.deepEqual(reply.results, []);
  assert.ok(calls.some((c) => c.method === "tools/call"));
  assert.equal(tavilyCalls.length + ddgCalls.length, 0);
});

test("structured Web Search uses the selected provider and disabled images honor it", async (t) => {
  setup(t);
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  // Local HTTP uses the real fetch; the provider alone uses the MCP fixture.
  const realFetch = require("node:http");
  const post = (path) => new Promise((resolve, reject) => {
    const req = realFetch.request({ hostname: "127.0.0.1", port: server.address().port, path, method: "POST",
      headers: { "Content-Type": "application/json" } }, (res) => {
      let body = ""; res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on("error", reject); req.end(JSON.stringify({ query: "solar costs" }));
  });
  const reply = await post("/api/web-search");
  assert.equal(reply.status, 200);
  assert.equal(reply.body.data.provider, "parallel");
  assert.equal(reply.body.data.results[0].url, RESULT.url);
  assert.match(reply.body.data.results[0].snippet, /Solar cost evidence/);
  config.webSearchProvider = "none";
  assert.equal((await post("/api/web-search")).status, 503);
  assert.equal((await post("/api/web-search/images")).status, 503);
});
