const test = require("node:test");
const assert = require("node:assert/strict");

const {
  performAgenticSearch,
  parsePlan,
  parseResearchPlan,
  parseGaps,
  parseClaims,
  normalizeUrl,
  dedupeResults,
  SourceRegistry,
  DEFAULTS,
} = require("../src/services/agenticSearchService");

// ── Parsing what the research model says ─────────────────────────────────────
// Models wrap JSON in prose, number lists they were told not to, and drift
// from the format. Every parser has to survive that.

test("queries are extracted from a plain reply, with list markers and quotes stripped", () => {
  const messy = '```\n1. "gate 2027 syllabus"\n- gate 2027 exam date\n* `gate cutoff`\n2) another one\n```';
  assert.deepEqual(parsePlan(messy, 5), ["gate 2027 syllabus", "gate 2027 exam date", "gate cutoff", "another one"]);
  assert.equal(parsePlan("one query\ntwo query\nthree query", 2).length, 2);
  assert.deepEqual(parsePlan("\n\nreal query\nabc\n", 5), ["real query"]);
  assert.deepEqual(parsePlan(null, 3), []);
});

test("a research plan is read from JSON, and the question itself is always searched", () => {
  const plan = parseResearchPlan(
    'Here is the plan:\n```json\n{"brief": "Costs of both", "angles": [{"question": "Solar cost", "queries": ["solar tariff 2026", "solar LCOE"]}, {"question": "Wind cost", "queries": ["wind tariff 2026", "SOLAR TARIFF 2026"]}]}\n```',
    "solar vs wind cost",
  );
  assert.equal(plan.brief, "Costs of both");
  assert.deepEqual(plan.angles.map((a) => a.question), ["Solar cost", "Wind cost"]);
  assert.deepEqual(plan.angles[0].queries, ["solar vs wind cost", "solar tariff 2026", "solar LCOE"]);
  assert.deepEqual(plan.angles[1].queries, ["wind tariff 2026"], "a query repeated across angles runs once");
});

test("a plan is capped, and an unusable plan falls back to researching the question", () => {
  const many = JSON.stringify({ angles: Array.from({ length: 9 }, (_, i) => ({ question: `Angle ${i}`, queries: [`query ${i} a`, `query ${i} b`, `query ${i} c`] })) });
  const capped = parseResearchPlan(many, "q?", { maxAngles: 3, queriesPerAngle: 2 });
  assert.equal(capped.angles.length, 3);
  assert.ok(capped.angles.slice(1).every((a) => a.queries.length === 2));

  assert.deepEqual(parseResearchPlan("first query\nsecond query", "the question").angles.map((a) => a.queries),
    [["the question", "first query"], ["second query"]]);
  assert.deepEqual(parseResearchPlan("{broken", "the question").angles, [{ question: "the question", queries: ["the question"] }]);
});

test("a very short or very long question is still searched when there is no plan", () => {
  assert.deepEqual(parseResearchPlan("", "AI").angles, [{ question: "AI", queries: ["AI"] }]);
  const long = `Compare ${"the costs, risks and timelines of solar and wind power ".repeat(12)}in India`;
  const [{ queries }] = parseResearchPlan("{broken", long).angles;
  assert.equal(queries.length, 1);
  assert.ok(queries[0].length <= 300 && long.startsWith(queries[0]), queries[0]);
  assert.ok(!/\s$/.test(queries[0]) && long[queries[0].length] === " ", "cut at a word");
  assert.deepEqual(parseResearchPlan("", "   ").angles, [{ question: "   ", queries: [] }]);
});

test("gaps map to their angle, and a gap no angle covers becomes a new one", () => {
  const v = parseGaps('{"sufficient": false, "gaps": [{"angle": 2, "missing": "a number", "query": "wind tariff 2026"}, {"angle": 0, "missing": "policy", "query": "renewable policy 2026"}, {"angle": 9, "query": "out of range angle"}]}', 2);
  assert.equal(v.sufficient, false);
  assert.deepEqual(v.gaps.map((g) => g.angle), [1, -1, -1]);
  assert.equal(v.gaps[0].missing, "a number");
});

test("only an explicit, usable request for more keeps the research going", () => {
  for (const reply of ["not json", "", null, "{broken", '{"sufficient": false, "gaps": []}', '{"sufficient": true, "gaps": [{"angle": 1, "query": "more please"}]}']) {
    assert.equal(parseGaps(reply, 2).sufficient, true, `reply: ${reply}`);
  }
  assert.deepEqual(parseGaps('{"sufficient": false, "followUps": ["older format query"]}', 2).gaps.map((g) => g.query), ["older format query"]);
  assert.equal(parseGaps('{"sufficient": false, "gaps": [{"query": "a b c d"}, {"query": "e f g h"}, {"query": "i j k l"}]}', 1, 2).gaps.length, 2);
});

test("claims to check keep their query and map S-labels back to sources", () => {
  const a = { url: "https://a.test" };
  const ids = new Map([["S1", a]]);
  const claims = parseClaims('{"claims": [{"claim": "Tariffs fell 20%", "sources": ["S1", "S9"], "query": "solar tariff fall 2026"}, {"claim": "", "query": "skip me please"}, {"claim": "no query"}]}', ids);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].query, "solar tariff fall 2026");
  assert.deepEqual(claims[0].sources, [a]);
  assert.deepEqual(parseClaims("nothing", ids), []);
});

// ── Sources ──────────────────────────────────────────────────────────────────

test("one page is one source, whatever tracking junk is on its URL", () => {
  assert.equal(normalizeUrl("https://www.Example.com/a/?utm_source=x&id=2#top"), normalizeUrl("https://example.com/a?id=2"));
  assert.notEqual(normalizeUrl("https://example.com/a?id=2"), normalizeUrl("https://example.com/a?id=3"));

  const registry = new SourceRegistry();
  registry.add([{ url: "https://www.site.test/x?utm_medium=y", title: "X", snippet: "s" }], { angle: 0, query: "q1" });
  registry.add([{ url: "https://site.test/x", title: "X again", text: "t".repeat(500) }, { url: "ftp://nope" }, null], { angle: 1, query: "q2" });
  assert.equal(registry.size, 1);
  const [source] = registry.list;
  assert.equal(source.title, "X", "the first sighting's title stays");
  assert.deepEqual([...source.angles], [0, 1]);
  assert.deepEqual([...source.queries], ["q1", "q2"]);
  assert.equal(source.text.length, 500, "page text found later is kept");
  assert.equal(registry.pagesRead, 1);
});

test("results dedupe by URL and keep first-seen order", () => {
  const merged = dedupeResults(dedupeResults([], [{ url: "a" }, { url: "b" }]), [{ url: "b" }, { url: "c" }, { title: "no url" }]);
  assert.deepEqual(merged.map((r) => r.url), ["a", "b", "c"]);
});

test("the research is bounded on every axis", () => {
  assert.ok(DEFAULTS.maxRounds >= 2 && DEFAULTS.maxRounds <= 4);
  assert.ok(DEFAULTS.maxQueries >= DEFAULTS.maxAngles * DEFAULTS.queriesPerAngle);
  assert.ok(DEFAULTS.readPages > 0 && DEFAULTS.maxSources > 0 && DEFAULTS.contextChars > 0);
  assert.ok(DEFAULTS.deadlineMs > 60000 && DEFAULTS.deadlineMs <= 180000);
});

// ── A whole research run ─────────────────────────────────────────────────────
// Scripted search results, research model and page reader, so the research
// logic is tested rather than the network.

const page = (url, title, text, extra = {}) => ({ url, title, snippet: text.slice(0, 120), text, ...extra });
const FILLER = "Cookie notice. Subscribe to our newsletter for updates. ".repeat(12);

const RESULTS = {
  "solar vs wind power cost india 2026": [
    page("https://news.test/overview", "Solar and wind costs compared", `${FILLER}\n\nIn 2026 solar power in India is cheaper than wind on average, at about ₹2.5 per kWh against ₹3.2 per kWh for wind.\n\n${FILLER}`),
  ],
  "solar tariff india 2026": [
    page("https://seci.test/solar", "SECI solar auction results 2026", `${FILLER}\n\nThe latest SECI solar auction in 2026 cleared at a tariff of ₹2.48 per kWh, a record low for India.\n\n${FILLER}`),
    { url: "https://blog.test/solar-boom", title: "Solar boom", snippet: "Solar tariff India 2026 hits record lows", text: "" },
  ],
  "solar lcoe india": [page("https://irena.test/lcoe", "IRENA cost report", `${FILLER}\n\nIRENA puts the levelised cost of solar in India at $0.035 per kWh, among the lowest in the world.\n\n${FILLER}`)],
  "wind tariff india 2026": [page("https://windpower.test/tariffs", "Wind tariffs edge up", `${FILLER}\n\nWind tariffs in India's 2026 auctions rose to ₹3.2 per kWh because of turbine costs.\n\n${FILLER}`)],
  "wind lcoe india": [],
  "renewable auction risks india": [page("https://analysis.test/risks", "Risks in India's renewable auctions", `${FILLER}\n\nAbout 30% of awarded solar capacity is still unsigned with distribution companies, a key risk to the low tariffs.\n\n${FILLER}`)],
  "seci wind auction tariff 2026": [page("https://seci.test/wind", "SECI wind auction 2026", `${FILLER}\n\nSECI's 2026 wind auction tariff was ₹3.18 per kWh.\n\n${FILLER}`)],
  "solar tariff record low 2.48 india": [page("https://mercom.test/record", "Record solar tariff confirmed", `${FILLER}\n\nMercom confirms the ₹2.48 per kWh solar tariff from SECI's 2026 auction is a record low.\n\n${FILLER}`)],
};

const PLAN = JSON.stringify({
  brief: "How the cost of solar and wind power compares in India in 2026",
  angles: [
    { question: "What does solar power cost in India in 2026?", queries: ["solar tariff india 2026", "solar lcoe india"] },
    { question: "What does wind power cost in India in 2026?", queries: ["wind tariff india 2026", "wind lcoe india"] },
    { question: "What risks could change these costs?", queries: ["renewable auction risks india"] },
  ],
});

function scriptedModel({ reflections = [], verification = '{"claims": []}', plan = PLAN } = {}) {
  const prompts = [];
  const queue = [...reflections];
  const fn = async (prompt) => {
    prompts.push(prompt);
    if (prompt.includes("planning a deep web investigation")) return plan;
    if (prompt.includes("reviewing the evidence")) return queue.shift() ?? '{"sufficient": true, "gaps": []}';
    if (prompt.includes("fact-checking")) {
      const s1 = (prompt.match(/^S(\d+) SECI solar auction results 2026/m) || [])[1];
      return verification.replace("SECI_SOLAR", s1 ? `S${s1}` : "S1");
    }
    return "";
  };
  return { fn, prompts };
}

function scriptedSearch(calls, results = RESULTS) {
  return async (q) => {
    calls.push(q);
    if (q === "boom") throw new Error("search backend down");
    return results[q.toLowerCase()] || [];
  };
}

test("a full run plans, searches every angle, reads pages, follows up, cross-checks and numbers the sources once", async () => {
  const calls = [];
  const reads = [];
  const snapshots = [];
  const statuses = [];
  const model = scriptedModel({
    reflections: ['{"sufficient": false, "gaps": [{"angle": 2, "missing": "the exact wind tariff", "query": "SECI wind auction tariff 2026"}]}'],
    verification: '{"claims": [{"claim": "SECI solar auction cleared at a record ₹2.48 per kWh", "sources": ["SECI_SOLAR"], "query": "solar tariff record low 2.48 india"}]}',
  });

  const result = await performAgenticSearch("solar vs wind power cost india 2026", {
    searchFn: scriptedSearch(calls),
    plannerFn: model.fn,
    readFn: async (url) => { reads.push(url); return url.includes("blog.test") ? `${FILLER}\n\nOur analysis: solar tariff in India for 2026 averages ₹2.6 per kWh.\n\n${FILLER}` : null; },
    history: "User: what about renewables in India?",
    onProgress: (s) => snapshots.push(s),
    onStatus: (m) => statuses.push(m),
  });

  // Planned, then followed up, then verified.
  assert.equal(calls[0], "solar vs wind power cost india 2026", "the question as asked is searched first");
  assert.ok(["solar tariff india 2026", "solar lcoe india", "wind tariff india 2026", "wind lcoe india", "renewable auction risks india"].every((q) => calls.includes(q)));
  assert.ok(calls.indexOf("SECI wind auction tariff 2026") > calls.indexOf("renewable auction risks india"));
  assert.equal(calls.at(-1), "solar tariff record low 2.48 india");
  assert.equal(result.rounds, 2);
  assert.deepEqual(result.queries, calls);
  assert.match(model.prompts[0], /what about renewables in India/, "the plan sees the conversation");

  // The keyless result with no page text was read in full.
  assert.deepEqual(reads, ["https://blog.test/solar-boom"]);

  // One numbering: the results' order is the context's [n].
  assert.ok(result.results.length >= 6);
  result.results.forEach((r, i) => assert.ok(result.context.includes(`[${i + 1}] ${r.title}`), `[${i + 1}] ${r.title}`));
  const urls = result.results.map((r) => r.url);
  assert.equal(new Set(urls).size, urls.length);

  // The passage that matters is quoted; the page furniture is not.
  assert.match(result.context, /cleared at a tariff of ₹2\.48 per kWh/);
  assert.match(result.context, /₹3\.18 per kWh/);
  assert.match(result.context, /solar tariff in India for 2026 averages ₹2\.6/, "text from a page read in full");
  assert.doesNotMatch(result.context, /Subscribe to our newsletter/);

  // Every angle is covered, and the claim is set against its independent check.
  assert.match(result.context, /\*\*Research plan\*\*/);
  for (const angle of ["What does solar power cost", "What does wind power cost", "What risks could change"]) {
    assert.match(result.context, new RegExp(`${angle}[^\\n]*sources \\[\\d+\\]`), angle);
  }
  const claimLine = result.context.split("\n").find((l) => l.includes("record ₹2.48 per kWh"));
  const solarN = urls.indexOf("https://seci.test/solar") + 1;
  const checkN = urls.indexOf("https://mercom.test/record") + 1;
  assert.ok(solarN > 0 && checkN > 0);
  assert.equal(claimLine, `- "SECI solar auction cleared at a record ₹2.48 per kWh" — from [${solarN}]; independent check: [${checkN}]`);

  // The activity log, as the browser sees it.
  const ids = snapshots.at(-1).steps.map((s) => s.id);
  assert.deepEqual(ids, ["plan", "search-0", "read", "reflect", "search-1", "reflect", "verify", "verify-search", "write"]);
  const last = snapshots.at(-1);
  assert.equal(last.phase, "writing");
  assert.deepEqual(last.steps.filter((s) => s.status === "active").map((s) => s.id), ["write"]);
  assert.equal(last.angles.length, 3);
  assert.equal(last.queries, calls.length);
  assert.equal(last.sources, 8);
  assert.equal(last.pagesRead, 8, "every source was read in full");
  assert.match(last.steps.find((s) => s.id === "reflect").detail, /Missing: the exact wind tariff/);
  assert.deepEqual(statuses.slice(0, 2), ["Planning the research…", "Searching 3 angles…"]);
  // What the panel shows beyond the steps: sites found, sources per angle, chips.
  assert.deepEqual(last.domains.slice(0, 3), ["news.test", "seci.test", "blog.test"]);
  assert.equal(last.sites, new Set(result.results.map((r) => new URL(r.url).hostname)).size);
  assert.equal(last.angleSources.length, 3);
  assert.ok(last.angleSources.every((n) => n > 0));
  const steps = Object.fromEntries(last.steps.map((s) => [s.id, s]));
  assert.ok(steps["search-0"].items.includes("solar tariff india 2026"));
  assert.ok(steps["search-0"].items.length <= 8);
  assert.deepEqual(steps.read.items, ["blog.test"]);
  assert.deepEqual(steps["verify-search"].items, ["SECI solar auction cleared at a record ₹2.48 per kWh"]);
  assert.deepEqual(result.angles.length, 3);

  // The compact context, for a writer with a small budget: same sources, same
  // numbers, shorter quotes.
  result.results.forEach((r, i) => assert.ok(result.compactContext.includes(`[${i + 1}] ${r.title}`)));
  assert.ok(result.compactContext.length <= result.context.length);
  assert.ok(result.compactContext.includes(claimLine), "the cross-check survives");
});

test("the compact context stays small however many sources there are", async () => {
  const many = Object.fromEntries(Object.keys(RESULTS).map((q) => [q, Array.from({ length: 6 }, (_, i) => page(`https://${q.replace(/\W+/g, "-")}-${i}.test/`, `Source ${q} ${i}`, `${FILLER}\n\n${"Solar and wind tariff data for India in 2026 with ₹ figures and analysis. ".repeat(30)}\n\n${FILLER}`))]));
  const result = await performAgenticSearch("solar vs wind power cost india 2026", {
    searchFn: scriptedSearch([], many), plannerFn: scriptedModel().fn, readFn: async () => null, verifyClaims: 0,
  });
  assert.equal(result.results.length, DEFAULTS.maxSources);
  assert.ok(result.compactContext.length <= 20000, `${result.compactContext.length} chars`);
  assert.ok(result.context.length > result.compactContext.length * 1.5);
});

test("without a research model, the question is searched and its pages still read", async () => {
  const calls = [];
  const snapshots = [];
  const result = await performAgenticSearch("solar tariff india 2026", {
    searchFn: scriptedSearch(calls),
    plannerFn: null,
    readFn: async () => `${FILLER}\n\nA page about the solar tariff in India in 2026 at ₹2.5 per kWh.\n\n${FILLER}`,
    onProgress: (s) => snapshots.push(s),
  });
  assert.deepEqual(calls, ["solar tariff india 2026"]);
  assert.deepEqual(snapshots.at(-1).steps.map((s) => s.id), ["search-0", "read", "write"]);
  assert.equal(result.results.length, 2);
  assert.match(result.context, /₹2\.5 per kWh/);
});

test("a research model that fails falls back to searching the question as asked", async () => {
  const calls = [];
  const result = await performAgenticSearch("wind tariff india 2026", {
    searchFn: scriptedSearch(calls),
    plannerFn: async () => { throw new Error("rate limited"); },
    readFn: async () => null,
  });
  assert.deepEqual(calls, ["wind tariff india 2026"]);
  assert.equal(result.results.length, 1);
});

test("a hungry reviewer never takes the research past its rounds or its query budget", async () => {
  const calls = [];
  const hungry = JSON.stringify({ sufficient: false, gaps: Array.from({ length: 6 }, (_, i) => ({ angle: 1, query: `more query ${Math.random()} ${i}` })) });
  const model = scriptedModel({ reflections: [hungry, hungry, hungry, hungry] });
  const result = await performAgenticSearch("solar vs wind power cost india 2026", {
    searchFn: scriptedSearch(calls),
    plannerFn: model.fn,
    readFn: async () => null,
    maxQueries: 10,
    verifyClaims: 2,
  });
  assert.ok(result.rounds <= DEFAULTS.maxRounds);
  assert.ok(calls.length <= 10, `${calls.length} searches`);
});

test("a failing search drops out without stopping the research", async () => {
  const calls = [];
  const plan = JSON.stringify({ angles: [{ question: "Q", queries: ["boom", "wind tariff india 2026"] }] });
  const result = await performAgenticSearch("solar tariff india 2026", {
    searchFn: scriptedSearch(calls),
    plannerFn: scriptedModel({ plan }).fn,
    readFn: async () => null,
  });
  assert.ok(calls.includes("boom"));
  assert.ok(result.results.some((r) => r.url === "https://windpower.test/tariffs"));
});

test("near the deadline the research stops reviewing and checking, and still answers", async () => {
  const calls = [];
  const snapshots = [];
  const result = await performAgenticSearch("solar vs wind power cost india 2026", {
    searchFn: scriptedSearch(calls),
    plannerFn: scriptedModel({ reflections: ['{"sufficient": false, "gaps": [{"angle": 1, "query": "never searched"}]}'] }).fn,
    readFn: async () => null,
    deadlineMs: 20000,
    onProgress: (s) => snapshots.push(s),
  });
  const ids = snapshots.at(-1).steps.map((s) => s.id);
  assert.ok(!ids.includes("reflect") && !ids.includes("verify"), ids.join(","));
  assert.ok(!calls.includes("never searched"));
  assert.ok(result.results.length > 0);
});

test("the evidence budget limits how many sources reach the writer", async () => {
  const big = await performAgenticSearch("solar vs wind power cost india 2026", {
    searchFn: scriptedSearch([]), plannerFn: scriptedModel().fn, readFn: async () => null, verifyClaims: 0,
  });
  const small = await performAgenticSearch("solar vs wind power cost india 2026", {
    searchFn: scriptedSearch([]), plannerFn: scriptedModel().fn, readFn: async () => null, verifyClaims: 0, contextChars: 700,
  });
  assert.ok(small.results.length >= 1 && small.results.length < big.results.length);
});

test("finding nothing is said plainly", async () => {
  const result = await performAgenticSearch("something nobody wrote about", {
    searchFn: async () => [], plannerFn: null, readFn: async () => null,
  });
  assert.deepEqual(result.results, []);
  assert.match(result.context, /SOURCES\*\*: none/);
});

test("a research model that hangs is given up on, and the research carries on without it", async () => {
  const calls = [];
  const started = Date.now();
  const result = await performAgenticSearch("wind tariff india 2026", {
    searchFn: scriptedSearch(calls),
    plannerFn: () => new Promise(() => {}),
    readFn: async () => null,
    deadlineMs: 13000,
  });
  assert.ok(Date.now() - started < 9000, `${Date.now() - started}ms`);
  assert.deepEqual(calls, ["wind tariff india 2026"]);
  assert.equal(result.results.length, 1);
});

test("a cancelled research stops searching, reading and asking the model, and returns what it has", async () => {
  const controller = new AbortController();
  const calls = [];
  const reads = [];
  const { fn, prompts } = scriptedModel({ reflections: ['{"sufficient": false, "gaps": [{"angle": 1, "missing": "x", "query": "solar lcoe india"}]}'] });
  const result = await performAgenticSearch("solar vs wind cost in india 2026", {
    searchFn: async (q) => {
      calls.push(q);
      controller.abort(); // the reader leaves during the first searches
      return RESULTS[q.toLowerCase()] || [];
    },
    plannerFn: fn,
    readFn: async (url) => { reads.push(url); return null; },
    searchConcurrency: 1,
    signal: controller.signal,
  });
  assert.equal(calls.length, 1, "searches queued behind the first are skipped");
  assert.deepEqual(reads, []);
  assert.equal(prompts.length, 1, "only the plan was asked for");
  assert.ok(Array.isArray(result.results));

  const before = new AbortController();
  before.abort();
  const searched = [];
  await performAgenticSearch("anything", { searchFn: async (q) => { searched.push(q); return []; }, plannerFn: fn, readFn: async () => null, signal: before.signal });
  assert.deepEqual(searched, []);
});
