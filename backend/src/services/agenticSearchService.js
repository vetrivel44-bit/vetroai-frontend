// Agentic web search: plan, search, read the results, decide what is still
// missing, search again.
//
// The existing performDeepSearch fans out — it asks a model for three queries
// up front, runs them, and concatenates whatever comes back. That is one shot
// of planning with no feedback: if all three queries miss, or if the answer
// needs a fact that only becomes obvious after reading the first round, nothing
// notices and the model answers from a gap.
//
// This runs a loop instead. After each round the planner sees what was actually
// found and either declares the evidence sufficient or names the gap and asks
// for targeted follow-ups. That is what makes multi-part questions work —
// "compare X and Y's 2026 pricing" needs one search per subject, and the second
// is often only expressible after the first has landed.
//
// Every round costs a small-model call plus its searches, so the loop is
// bounded three ways: rounds, total queries, and a wall-clock deadline. It
// always returns whatever evidence it has rather than throwing, because a
// partial answer with sources beats no answer at all.
const Groq = require("groq-sdk");
const { searchWeb } = require("../controllers/searchController");
const { config } = require("../config/env");
const logger = require("../utils/logger");

const DEFAULTS = {
  maxRounds: 3,
  maxQueries: 8,
  deadlineMs: 28000,
  seedQueries: 3,
  followUpQueries: 2,
};

const groqClient = () => (config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null);

/**
 * Pull queries out of a model reply. Small models ignore "no numbering" about
 * as often as they obey it, so strip list markers, quotes and stray fences
 * rather than trusting the format.
 */
function parsePlan(text, limit) {
  if (typeof text !== "string") return [];
  return text
    .replace(/```[a-z]*|```/gi, "")
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s*/, "")     // bullets
        .replace(/^\d+[.)]\s*/, "")        // numbering
        .replace(/^["'`]+|["'`]+$/g, "")   // wrapping quotes
        .trim()
    )
    .filter((q) => q.length > 3 && q.length <= 300)
    .slice(0, limit);
}

/**
 * Read the reflection step's verdict. Models wrap JSON in prose and fences, so
 * take the first balanced-looking object rather than JSON.parse on the whole
 * reply. An unreadable verdict is treated as "sufficient" — continuing to
 * search on a response we cannot understand burns budget for nothing.
 */
function parseReflection(text) {
  const fallback = { sufficient: true, missing: "", followUps: [] };
  if (typeof text !== "string") return fallback;

  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return fallback;

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return fallback;
  }

  const followUps = Array.isArray(parsed.followUps)
    ? parsed.followUps
        .filter((q) => typeof q === "string")
        .map((q) => q.trim())
        .filter((q) => q.length > 3 && q.length <= 300)
    : [];

  return {
    // Only an explicit false means "keep going"; anything else stops the loop.
    sufficient: parsed.sufficient !== false || followUps.length === 0,
    missing: typeof parsed.missing === "string" ? parsed.missing : "",
    followUps,
  };
}

/** Merge result lists, keeping first-seen order and dropping repeated URLs. */
function dedupeResults(existing, incoming) {
  const seen = new Set(existing.map((r) => r.url).filter(Boolean));
  const merged = [...existing];
  for (const r of incoming || []) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    merged.push(r);
  }
  return merged;
}

/**
 * Assemble what the answering model sees. The numbered SOURCES block is what
 * makes citation possible: without stable numbers the model invents its own
 * references, which look like citations but point nowhere.
 */
function buildContext({ query, rounds, results }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const parts = [
    `**Search Date**: ${today} | **Original question**: "${query}"`,
    `**Research path**: ${rounds.map((r, i) => `Round ${i + 1} — ${r.queries.join("; ")}`).join(" → ")}`,
  ];

  for (const round of rounds) {
    if (round.context) parts.push(round.context);
  }

  if (results.length) {
    const sources = results
      .map((r, i) => `[${i + 1}] ${r.title || "(untitled)"} — ${r.url}`)
      .join("\n");
    parts.push(
      `**SOURCES** (cite these by number, e.g. [2], when you use them):\n${sources}`
    );
  }

  return parts.join("\n\n---\n\n");
}

const PLAN_PROMPT = (query, today) =>
  `You plan web searches. Break this question into up to ${DEFAULTS.seedQueries} specific search queries that together would answer it: "${query}"

Today is ${today}. For anything recent, target current data rather than older predictions.
If the question has multiple parts or subjects, give each its own query.
Reply with the queries only, one per line. No numbering, no quotes, no commentary.`;

const REFLECT_PROMPT = (query, evidence, roundsLeft) =>
  `Question: "${query}"

Evidence gathered so far:
${evidence}

Decide whether this evidence is enough to answer the question fully and accurately.
You may request up to ${DEFAULTS.followUpQueries} more searches (${roundsLeft} round(s) remain).
Only ask for more if something specific and necessary is missing — not to gather nice-to-haves.

Reply with JSON only:
{"sufficient": true|false, "missing": "what is missing, one short phrase", "followUps": ["query", "..."]}`;

async function askPlanner(client, prompt, maxTokens) {
  const completion = await client.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: config.searchPlannerModel,
    temperature: 0.1,
    max_tokens: maxTokens,
  });
  return completion.choices[0]?.message?.content || "";
}

/** One round of searches, run together. Failures drop out rather than abort. */
async function runQueries(queries, searchFn, onStatus) {
  const settled = await Promise.allSettled(queries.map((q) => searchFn(q)));
  const contexts = [];
  let results = [];

  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      if (outcome.value?.context) contexts.push(outcome.value.context);
      results = dedupeResults(results, outcome.value?.results);
    } else {
      logger.warn("agenticSearch.query.failed", {
        query: queries[i],
        error: outcome.reason?.message,
      });
    }
  });

  onStatus?.(null);
  return { context: contexts.join("\n\n---\n\n"), results };
}

/**
 * Run the search loop.
 *
 * @param {string} query        the user's question
 * @param {object} [options]
 * @param {(msg: string) => void} [options.onStatus] progress, for streaming to the client
 * @param {Function} [options.searchFn]  overrides the search backend (tests)
 * @param {Function} [options.plannerFn] overrides the planner call (tests)
 * @returns {Promise<{context: string, results: object[], rounds: number, queries: string[]}>}
 */
async function performAgenticSearch(query, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { onStatus } = opts;
  const searchFn = opts.searchFn || searchWeb;
  const startedAt = Date.now();
  const timeLeft = () => opts.deadlineMs - (Date.now() - startedAt);

  // plannerFn lets tests drive the loop deterministically; in production it is
  // the small model, and its absence is what disables the loop entirely.
  const client = opts.plannerFn ? { injected: true } : groqClient();
  const plan = opts.plannerFn || ((prompt, maxTokens) => askPlanner(client, prompt, maxTokens));
  const rounds = [];
  const usedQueries = [];
  let results = [];

  // Without a planner there is nothing agentic to do; a plain search is the
  // honest fallback rather than pretending to iterate.
  if (!client) {
    logger.info("agenticSearch.noPlanner");
    onStatus?.("Searching the web…");
    const single = await searchFn(query);
    return { context: single.context, results: single.results || [], rounds: 1, queries: [query] };
  }

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // ── Round 1: plan and search ────────────────────────────────────────────────
  let queries = [query];
  try {
    onStatus?.("Planning searches…");
    queries = parsePlan(await plan(PLAN_PROMPT(query, today), 160), opts.seedQueries);
    if (!queries.length) queries = [query];
  } catch (err) {
    logger.warn("agenticSearch.plan.failed", { error: err.message });
    queries = [query];
  }

  for (let round = 0; round < opts.maxRounds; round += 1) {
    const budgetLeft = opts.maxQueries - usedQueries.length;
    if (budgetLeft <= 0 || timeLeft() <= 0) break;

    const batch = queries.slice(0, budgetLeft);
    if (!batch.length) break;

    onStatus?.(
      round === 0
        ? `Searching: ${batch.join(", ")}`
        : `Following up: ${batch.join(", ")}`
    );

    const { context, results: found } = await runQueries(batch, searchFn, onStatus);
    usedQueries.push(...batch);
    results = dedupeResults(results, found);
    rounds.push({ queries: batch, context });

    const roundsLeft = opts.maxRounds - round - 1;
    // No point reflecting with nothing left to spend on the answer.
    if (roundsLeft <= 0 || usedQueries.length >= opts.maxQueries || timeLeft() < 6000) break;

    // ── Reflect: is this enough, and if not, what exactly is missing? ────────
    const evidence = results
      .slice(0, 12)
      .map((r, i) => `[${i + 1}] ${r.title || "(untitled)"} — ${(r.snippet || r.content || "").slice(0, 200)}`)
      .join("\n");

    let verdict;
    try {
      onStatus?.("Checking what's still missing…");
      verdict = parseReflection(
        await plan(REFLECT_PROMPT(query, evidence || "(nothing found yet)", roundsLeft), 220)
      );
    } catch (err) {
      logger.warn("agenticSearch.reflect.failed", { error: err.message });
      break;
    }

    if (verdict.sufficient || !verdict.followUps.length) break;

    logger.info("agenticSearch.followUp", { missing: verdict.missing, followUps: verdict.followUps });
    queries = verdict.followUps.slice(0, opts.followUpQueries);
  }

  logger.info("agenticSearch.done", {
    rounds: rounds.length,
    queries: usedQueries.length,
    results: results.length,
    ms: Date.now() - startedAt,
  });

  return {
    context: buildContext({ query, rounds, results }),
    results,
    rounds: rounds.length,
    queries: usedQueries,
  };
}

module.exports = {
  performAgenticSearch,
  // exported for tests
  parsePlan,
  parseReflection,
  dedupeResults,
  buildContext,
  DEFAULTS,
};
