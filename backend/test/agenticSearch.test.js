const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePlan,
  parseReflection,
  dedupeResults,
  buildContext,
  DEFAULTS,
} = require("../src/services/agenticSearchService");

// ── Plan parsing ──────────────────────────────────────────────────────────────
// Small models ignore "no numbering" roughly as often as they obey it, so the
// parser has to survive whatever shape comes back.

test("queries are extracted from a clean reply", () => {
  assert.deepEqual(parsePlan("gate 2027 syllabus\ngate 2027 exam date", 3), [
    "gate 2027 syllabus",
    "gate 2027 exam date",
  ]);
});

test("numbering, bullets, quotes and code fences are stripped", () => {
  const messy = '```\n1. "gate 2027 syllabus"\n- gate 2027 exam date\n* `gate cutoff`\n2) another one\n```';
  assert.deepEqual(parsePlan(messy, 5), [
    "gate 2027 syllabus",
    "gate 2027 exam date",
    "gate cutoff",
    "another one",
  ]);
});

test("the plan is capped and junk lines dropped", () => {
  assert.equal(parsePlan("query one\nquery two\nquery three\nquery four", 2).length, 2);
  // Fragments of four characters or fewer are noise, not search queries.
  assert.deepEqual(parsePlan("\n\nreal query\nabc\n   \n", 5), ["real query"]);
  assert.deepEqual(parsePlan(null, 3), []);
  assert.deepEqual(parsePlan("y".repeat(400), 3), []); // absurdly long
});

// ── Reflection parsing ────────────────────────────────────────────────────────

test("a follow-up request keeps the loop going", () => {
  const v = parseReflection('{"sufficient": false, "missing": "2026 pricing", "followUps": ["x pricing 2026"]}');
  assert.equal(v.sufficient, false);
  assert.equal(v.missing, "2026 pricing");
  assert.deepEqual(v.followUps, ["x pricing 2026"]);
});

test("JSON wrapped in prose or fences is still read", () => {
  const v = parseReflection('Sure!\n```json\n{"sufficient": false, "followUps": ["one more"]}\n```\nHope that helps.');
  assert.equal(v.sufficient, false);
  assert.deepEqual(v.followUps, ["one more"]);
});

test("an unreadable verdict stops the loop rather than burning budget", () => {
  // Continuing to search on a reply we cannot parse spends rounds for nothing.
  for (const bad of ["not json at all", "", null, "{broken json", undefined]) {
    assert.equal(parseReflection(bad).sufficient, true, `input: ${bad}`);
  }
});

test("insufficient with no follow-ups still stops", () => {
  // Nothing to search for next — looping again would repeat the same queries.
  const v = parseReflection('{"sufficient": false, "missing": "everything", "followUps": []}');
  assert.equal(v.sufficient, true);
});

test("malformed follow-up entries are discarded", () => {
  const v = parseReflection('{"sufficient": false, "followUps": ["good query", 42, null, "x", "' + "z".repeat(400) + '"]}');
  assert.deepEqual(v.followUps, ["good query"]);
});

// ── Result accumulation ───────────────────────────────────────────────────────

test("results dedupe by URL and keep first-seen order", () => {
  const first = dedupeResults([], [{ url: "a", title: "A" }, { url: "b", title: "B" }]);
  const second = dedupeResults(first, [{ url: "b", title: "B again" }, { url: "c", title: "C" }]);
  assert.deepEqual(second.map((r) => r.url), ["a", "b", "c"]);
  assert.equal(second[1].title, "B", "the first sighting wins");
});

test("results without a URL are dropped", () => {
  assert.deepEqual(dedupeResults([], [{ title: "no url" }, null, { url: "", title: "blank" }]), []);
  assert.deepEqual(dedupeResults([], undefined), []);
});

// ── Context assembly ──────────────────────────────────────────────────────────

test("context carries numbered sources for citation", () => {
  // Without stable numbers the model invents its own references, which look
  // like citations but point nowhere.
  const ctx = buildContext({
    query: "compare a and b",
    rounds: [{ queries: ["a pricing"], context: "round one text" }],
    results: [{ title: "A docs", url: "https://a.test" }, { title: "B docs", url: "https://b.test" }],
  });
  assert.match(ctx, /\*\*SOURCES\*\*/);
  assert.match(ctx, /\[1\] A docs — https:\/\/a\.test/);
  assert.match(ctx, /\[2\] B docs — https:\/\/b\.test/);
  assert.match(ctx, /round one text/);
  assert.match(ctx, /compare a and b/);
});

test("the research path is recorded across rounds", () => {
  const ctx = buildContext({
    query: "q",
    rounds: [{ queries: ["first"], context: "" }, { queries: ["second", "third"], context: "" }],
    results: [],
  });
  assert.match(ctx, /Round 1 — first → Round 2 — second; third/);
});

test("no results means no empty SOURCES block", () => {
  const ctx = buildContext({ query: "q", rounds: [{ queries: ["x"], context: "" }], results: [] });
  assert.ok(!ctx.includes("SOURCES"));
});

// ── Budgets ───────────────────────────────────────────────────────────────────

test("the loop is bounded on every axis", () => {
  // Each round costs a planner call plus its searches, so an unbounded loop is
  // an unbounded bill.
  assert.ok(DEFAULTS.maxRounds >= 2 && DEFAULTS.maxRounds <= 5);
  assert.ok(DEFAULTS.maxQueries >= DEFAULTS.seedQueries);
  assert.ok(DEFAULTS.deadlineMs > 0 && DEFAULTS.deadlineMs <= 60000);
});

// ── The loop itself ───────────────────────────────────────────────────────────
// Driven with a stubbed planner and search backend, so the iteration is tested
// rather than the network.

const { performAgenticSearch } = require("../src/services/agenticSearchService");

/** A search backend that records what it was asked and returns one result each. */
function stubSearch(calls) {
  return async (q) => {
    calls.push(q);
    return { context: `ctx:${q}`, results: [{ url: `https://x/${encodeURIComponent(q)}`, title: q }] };
  };
}

/** A planner that replays scripted replies in order. */
function stubPlanner(replies) {
  const queue = [...replies];
  return async () => queue.shift() ?? '{"sufficient": true}';
}

test("a satisfied planner stops after one round", async () => {
  const calls = [];
  const out = await performAgenticSearch("q", {
    searchFn: stubSearch(calls),
    plannerFn: stubPlanner(["alpha query\nbeta query", '{"sufficient": true, "followUps": []}']),
  });
  assert.deepEqual(calls, ["alpha query", "beta query"]);
  assert.equal(out.rounds, 1);
});

test("an unsatisfied planner triggers a second round with its follow-ups", async () => {
  // This is the whole point of the feature: the second query is one that could
  // not have been written before seeing the first round's results.
  const calls = [];
  const out = await performAgenticSearch("compare a and b", {
    searchFn: stubSearch(calls),
    plannerFn: stubPlanner([
      "a overview",
      '{"sufficient": false, "missing": "b pricing", "followUps": ["b pricing 2026"]}',
      '{"sufficient": true}',
    ]),
  });
  assert.deepEqual(calls, ["a overview", "b pricing 2026"]);
  assert.equal(out.rounds, 2);
  assert.match(out.context, /Round 1 — a overview → Round 2 — b pricing 2026/);
});

test("the loop never exceeds maxRounds however hungry the planner is", async () => {
  const calls = [];
  const alwaysMore = async () => '{"sufficient": false, "missing": "more", "followUps": ["again"]}';
  const out = await performAgenticSearch("q", {
    searchFn: stubSearch(calls),
    plannerFn: alwaysMore,
    maxRounds: 2,
  });
  assert.equal(out.rounds, 2);
});

test("the query budget caps total searches", async () => {
  const calls = [];
  const out = await performAgenticSearch("q", {
    searchFn: stubSearch(calls),
    plannerFn: stubPlanner([
      "query one\nquery two\nquery three",
      '{"sufficient": false, "followUps": ["query four", "query five"]}',
      '{"sufficient": true}',
    ]),
    maxQueries: 4,
    seedQueries: 3,
  });
  assert.equal(calls.length, 4, "stops at the budget mid-round");
  assert.deepEqual(calls, ["query one", "query two", "query three", "query four"]);
  assert.ok(out.queries.length <= 4);
});

test("a failing search does not abort the round", async () => {
  const calls = [];
  const flaky = async (q) => {
    calls.push(q);
    if (q === "failing query") throw new Error("upstream down");
    return { context: `ctx:${q}`, results: [{ url: `https://x/${q}`, title: q }] };
  };
  const out = await performAgenticSearch("q", {
    searchFn: flaky,
    plannerFn: stubPlanner(["working query\nfailing query", '{"sufficient": true}']),
  });
  assert.equal(calls.length, 2);
  assert.equal(out.results.length, 1, "the surviving result is kept");
});

test("a planner that throws falls back to searching the raw question", async () => {
  const calls = [];
  const out = await performAgenticSearch("raw question", {
    searchFn: stubSearch(calls),
    plannerFn: async () => { throw new Error("planner down"); },
  });
  assert.deepEqual(calls, ["raw question"]);
  assert.equal(out.rounds, 1);
});

test("progress is reported for streaming to the client", async () => {
  const seen = [];
  await performAgenticSearch("q", {
    searchFn: stubSearch([]),
    plannerFn: stubPlanner(["alpha", '{"sufficient": false, "followUps": ["beta"]}', '{"sufficient": true}']),
    onStatus: (m) => { if (m) seen.push(m); },
  });
  assert.ok(seen.some((m) => /Planning/i.test(m)));
  assert.ok(seen.some((m) => /Searching: alpha/.test(m)));
  assert.ok(seen.some((m) => /Following up: beta/.test(m)));
});
