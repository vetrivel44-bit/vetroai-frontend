const test = require("node:test");
const assert = require("node:assert/strict");
const { webSearchProfile, researchProfile, normalizeEffort } = require("../src/services/searchEffort");

test("search effort: unknown effort is balanced", () => {
  assert.equal(normalizeEffort("bogus"), "balanced");
  assert.equal(webSearchProfile(undefined).effort, "balanced");
});

test("search effort: higher effort searches wider and deeper", () => {
  const order = ["quick", "balanced", "deep", "max"].map(webSearchProfile);
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i].maxResults > order[i - 1].maxResults, `${order[i].effort} results`);
    assert.ok(order[i].fullPages > order[i - 1].fullPages, `${order[i].effort} pages`);
  }
  assert.equal(webSearchProfile("quick").depth, "basic");
  assert.equal(webSearchProfile("max").depth, "advanced");
});

test("search effort: DeepSearch does more research at higher effort", () => {
  const quick = researchProfile("quick");
  const max = researchProfile("max");
  assert.ok(quick.maxQueries < max.maxQueries);
  assert.ok(quick.maxRounds < max.maxRounds);
  assert.ok(quick.readPages < max.readPages);
  assert.equal(researchProfile("balanced").maxQueries, undefined, "balanced keeps the service defaults");
});

test("search effort: searchWeb asks Tavily for the effort's depth and page text", async () => {
  const { config } = require("../src/config/env");
  const tavilyPath = require.resolve("@tavily/core");
  require(tavilyPath);
  const realExports = require.cache[tavilyPath].exports;
  const calls = [];
  const content = "x".repeat(6000);
  require.cache[tavilyPath].exports = { tavily: () => ({ search: async (_q, opts) => { calls.push(opts); return { results: Array.from({ length: opts.maxResults }, (_, i) => ({ title: `T${i}`, url: `https://e${i}.test/`, content })) }; } }) };
  const prevKey = config.tavilyApiKey;
  config.tavilyApiKey = "test";
  try {
    // searchController holds its own reference to tavily(); reload it.
    delete require.cache[require.resolve("../src/controllers/searchController")];
    const fresh = require("../src/controllers/searchController");
    const quick = await fresh.searchWeb("capital of france history", { effort: "quick" });
    const max = await fresh.searchWeb("capital of france history", { effort: "max" });
    assert.equal(calls[0].searchDepth, "basic");
    assert.equal(calls[0].maxResults, 5);
    assert.equal(calls[1].searchDepth, "advanced");
    assert.equal(calls[1].maxResults, 12);
    assert.equal((quick.context.match(/Full Content/g) || []).length, 1);
    assert.equal((max.context.match(/Full Content/g) || []).length, 6);
    assert.ok(max.context.length > quick.context.length * 3);
  } finally {
    require.cache[tavilyPath].exports = realExports;
    config.tavilyApiKey = prevKey;
    delete require.cache[require.resolve("../src/controllers/searchController")];
  }
});
