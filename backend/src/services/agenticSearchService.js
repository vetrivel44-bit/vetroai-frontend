// DeepSearch: multi-angle web research, in the style of Claude's Research.
//
// One round of "ask a model for three queries, paste the snippets together"
// misses most of what a real investigation needs: the answer's number is
// further down the page than the snippet, the second half of a comparison is
// only searchable once the first half is known, and a claim from one blog post
// reads the same as one confirmed by five sources. So the research runs in
// phases:
//
//   1. Plan     — a research model splits the question into 2–5 angles (core
//                 facts, latest developments, numbers, comparisons, risks…),
//                 each with its own search queries.
//   2. Search   — every angle's queries run in parallel.
//   3. Read     — pages are read in full (Tavily returns their text; other
//                 results are fetched), and the passages that bear on each
//                 angle are picked out without spending model tokens.
//   4. Reflect  — the model reviews the evidence per angle, names what is
//                 missing (a number nobody states, sources that disagree, an
//                 aspect nobody covered) and asks for targeted follow-ups.
//                 Up to two more rounds.
//   5. Verify   — the model picks the claims the answer will lean on that only
//                 one source makes, or that sources dispute, and each gets an
//                 independent search.
//   6. Assemble — sources are chosen round-robin across angles so every angle
//                 is represented, numbered once, and handed to the writing
//                 model with their best passages and the cross-check list.
//
// Progress is reported as a snapshot after every step, which the chat streams
// to the browser as a live activity panel. Every phase is bounded (rounds,
// queries, pages, a wall-clock deadline), and the research always returns what
// it has rather than throwing: a partial report with real sources beats none.
const Groq = require("groq-sdk");
const { searchForResearch } = require("../controllers/searchController");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const { withGroqModel } = require("../utils/groqModel");
const mistralAdapter = require("../providers/mistralAdapter");
const { describeClock } = require("./clockService");
const { fetchPageText, keyTerms, indexPassages, pickPassages } = require("./pageReader");
const { withTimeout } = require("../utils/withTimeout");

const DEFAULTS = {
  maxAngles: 5,          // research angles planned up front
  queriesPerAngle: 2,
  maxRounds: 3,          // the first search round plus up to two follow-ups
  maxQueries: 24,        // searches across the whole run, verification included
  followUpQueries: 4,    // per follow-up round
  verifyClaims: 4,       // claims given an independent check
  readPages: 12,         // pages fetched directly (Tavily results arrive already read)
  maxSources: 24,        // sources handed to the writer
  contextChars: 42000,   // evidence budget for the writer, about 10k tokens
  searchConcurrency: 6,
  deadlineMs: 150000,
};

// Only the start of a very long page is kept: the relevant passages are
// almost always there, and scoring megabytes of text costs real CPU.
const MAX_PAGE_CHARS = 200000;
// Longest wait for one research-model call. The Groq SDK would otherwise wait
// a minute and retry, and one hung call could eat the whole research budget.
const THINK_TIMEOUT_MS = 25000;

// ── Small parsing helpers ───────────────────────────────────────────────────

const isUsableQuery = (q) => typeof q === "string" && q.trim().length > 3 && q.trim().length <= 300;
const cleanLine = (line) => line
  .trim()
  .replace(/^[-*•]\s*/, "")
  .replace(/^\d+[.)]\s*/, "")
  .replace(/^["'`]+|["'`]+$/g, "")
  .trim();

/**
 * Pull queries out of a plain-text reply, one per line. Small models ignore
 * "no numbering" about as often as they obey it, so strip list markers,
 * quotes and stray fences rather than trusting the format.
 */
function parsePlan(text, limit) {
  if (typeof text !== "string") return [];
  return text
    .replace(/```[a-z]*|```/gi, "")
    .split("\n")
    .map(cleanLine)
    .filter(isUsableQuery)
    .slice(0, limit);
}

/** The first {...} in a reply, parsed. Models wrap JSON in prose and fences. */
function firstJsonObject(text) {
  if (typeof text !== "string") return null;
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

/**
 * Reads the research plan. Falls back to a one-query-per-line reply, and
 * then to researching the question as asked, so a model that ignores the
 * format still gets a usable plan.
 */
function parseResearchPlan(text, query, { maxAngles = DEFAULTS.maxAngles, queriesPerAngle = DEFAULTS.queriesPerAngle } = {}) {
  const parsed = firstJsonObject(text);
  const seen = new Set();
  const fresh = (q) => {
    const key = q.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  let angles = [];
  if (parsed && Array.isArray(parsed.angles)) {
    angles = parsed.angles
      .filter((a) => a && typeof a.question === "string" && a.question.trim())
      .map((a) => ({
        question: a.question.trim().slice(0, 300),
        queries: (Array.isArray(a.queries) ? a.queries : [])
          .filter(isUsableQuery)
          .map((q) => cleanLine(q))
          .filter(fresh)
          .slice(0, queriesPerAngle),
      }))
      .filter((a) => a.queries.length)
      .slice(0, maxAngles);
  }
  // A one-query-per-line reply still works; a broken attempt at JSON would
  // only yield fragments like `{"angles": [` as queries.
  if (!angles.length && !/[{}[\]]/.test(String(text || ""))) {
    angles = parsePlan(text, maxAngles).filter(fresh).map((q) => ({ question: q, queries: [q] }));
  }
  if (!angles.length) angles = [{ question: query, queries: [] }];

  // The question as asked is always searched too: search engines handle
  // natural language well, and it guards against a plan that drifted.
  if (isUsableQuery(query) && fresh(query)) angles[0].queries.unshift(query.trim());

  return {
    brief: typeof parsed?.brief === "string" ? parsed.brief.trim().slice(0, 400) : "",
    angles,
  };
}

/**
 * Reads the reviewer's verdict. Only an explicit "sufficient": false with
 * usable follow-ups keeps the research going: continuing on a reply we can't
 * understand would spend the budget for nothing.
 */
function parseGaps(text, angleCount, limit = DEFAULTS.followUpQueries) {
  const stop = { sufficient: true, gaps: [] };
  const parsed = firstJsonObject(text);
  if (!parsed) return stop;

  let gaps = [];
  if (Array.isArray(parsed.gaps)) {
    gaps = parsed.gaps
      .filter((g) => g && isUsableQuery(g.query))
      .map((g) => {
        const n = Number(g.angle);
        return {
          angle: Number.isInteger(n) && n >= 1 && n <= angleCount ? n - 1 : -1,
          missing: typeof g.missing === "string" ? g.missing.trim().slice(0, 200) : "",
          query: cleanLine(g.query),
        };
      });
  } else if (Array.isArray(parsed.followUps)) {
    gaps = parsed.followUps.filter(isUsableQuery).map((q) => ({ angle: -1, missing: "", query: cleanLine(q) }));
  }
  gaps = gaps.slice(0, limit);
  return { sufficient: parsed.sufficient !== false || !gaps.length, gaps };
}

/** Reads the fact-check list. `ids` maps the "S3" labels the model saw back to sources. */
function parseClaims(text, ids, limit = DEFAULTS.verifyClaims) {
  const parsed = firstJsonObject(text);
  if (!parsed || !Array.isArray(parsed.claims)) return [];
  return parsed.claims
    .filter((c) => c && typeof c.claim === "string" && c.claim.trim() && isUsableQuery(c.query))
    .slice(0, limit)
    .map((c) => ({
      claim: c.claim.trim().slice(0, 300),
      query: cleanLine(c.query),
      sources: (Array.isArray(c.sources) ? c.sources : [])
        .map((s) => ids.get(String(s).trim().toUpperCase()))
        .filter(Boolean),
    }));
}

// ── Sources ─────────────────────────────────────────────────────────────────

/** Strips tracking parameters, fragments and trailing slashes, so one page is one source. */
function normalizeUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href.replace(/\/$/, "").toLowerCase();
  } catch {
    return String(raw || "").toLowerCase();
  }
}

const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** Every page the research has seen, once each, with which angles and queries found it. */
class SourceRegistry {
  constructor() {
    this.byKey = new Map();
    this.list = [];
  }

  add(results, { angle = null, claim = null, query = "" } = {}) {
    let added = 0;
    (results || []).forEach((r, rank) => {
      if (!r?.url || !/^https?:\/\//i.test(r.url)) return;
      const key = normalizeUrl(r.url);
      let source = this.byKey.get(key);
      if (!source) {
        source = {
          url: r.url,
          title: (r.title || "").trim(),
          snippet: (r.snippet || r.description || r.content || "").trim(),
          text: typeof r.text === "string" ? r.text.slice(0, MAX_PAGE_CHARS) : "",
          published: r.published || r.publishedDate || r.published_date || null,
          angles: new Set(),
          claims: new Set(),
          queries: new Set(),
          bestRank: rank,
          fetched: false,
        };
        this.byKey.set(key, source);
        this.list.push(source);
        added += 1;
      } else {
        if (!source.text && r.text) source.text = r.text.slice(0, MAX_PAGE_CHARS);
        if (!source.snippet && r.snippet) source.snippet = r.snippet;
        if (!source.published && r.published) source.published = r.published;
        source.bestRank = Math.min(source.bestRank, rank);
      }
      if (angle != null) source.angles.add(angle);
      if (claim != null) source.claims.add(claim);
      if (query) source.queries.add(query);
    });
    return added;
  }

  get size() { return this.list.length; }
  get pagesRead() { return this.list.filter((s) => s.text.length >= 400).length; }
}

/** A source's passages, indexed once per version of its text. */
function indexedPassages(source) {
  const body = source.text.length >= 400 ? source.text : `${source.title}\n${source.snippet}`;
  if (source.indexed?.body !== body) source.indexed = { body, passages: indexPassages(body) };
  return source.indexed.passages;
}

/** A source's relevance to a set of terms, and the passages that carry it. */
function assess(source, terms) {
  const { score, passages } = pickPassages(indexedPassages(source), terms, { max: 3, maxChars: 1500 });
  const fallback = (source.snippet || source.text).slice(0, 400).trim();
  return {
    passages: passages.length ? passages : (fallback ? [fallback] : []),
    score: score
      + 0.6 * Math.min(source.queries.size, 4)
      + 1 / (1 + source.bestRank)
      + (source.text.length >= 400 ? 0.4 : 0),
  };
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const PLAN_PROMPT = ({ query, today, history, maxAngles, queriesPerAngle }) => `You are the lead researcher planning a deep web investigation, the way a careful analyst plans before writing a report.

Question: "${query}"
${history ? `\nEarlier in the conversation (use it to work out what the question refers to):\n${history}\n` : ""}
Today is ${today}.

Break the question into 2 to ${maxAngles} distinct research angles that together give a complete, well-evidenced answer. Typical angles: the core facts or definitions; the latest developments; the key numbers and data; comparisons or alternatives; risks, criticism or counter-evidence; what official or primary sources say. Only include the angles this question really needs; a simple question needs only two.

For each angle write ${queriesPerAngle} web search queries: short search phrases rather than sentences, specific, with names, places and years where they help. For anything that changes over time, aim at current information.

Reply with JSON only, no other text:
{"brief": "one sentence: what a complete answer has to establish", "angles": [{"question": "the sub-question", "queries": ["search query", "search query"]}]}`;

const REFLECT_PROMPT = ({ query, brief, digest, budget }) => `You are reviewing the evidence gathered so far for a research report.

Question: "${query}"
${brief ? `What the report has to establish: ${brief}\n` : ""}
Evidence found so far, by research angle:
${digest}

Is this enough to write a complete, accurate, well-sourced answer? Look for: an angle with little or no evidence; a key number, date or name that no source states; sources that disagree; information that may be out of date; an important aspect that no angle covers.

You may request up to ${budget} more searches. Request only what is necessary, not nice-to-haves.

Reply with JSON only:
{"sufficient": true or false, "gaps": [{"angle": angle number, or 0 for an aspect no angle covers, "missing": "what is missing, briefly", "query": "web search query"}]}`;

const VERIFY_PROMPT = ({ query, digest, limit }) => `You are fact-checking a research report before it is written.

Question: "${query}"

Sources gathered so far:
${digest}

Pick up to ${limit} specific factual claims from these sources that the answer will depend on and that need an independent check: stated by only one source, contradicted by another source, surprising, or possibly out of date. Skip claims several sources already agree on.

For each, write one web search query that would independently confirm or refute it.

Reply with JSON only:
{"claims": [{"claim": "the claim, stated precisely", "sources": ["S2"], "query": "search query"}]}
If nothing needs checking, reply {"claims": []}.`;

// ── The research model ──────────────────────────────────────────────────────

/**
 * The model that plans, reviews and picks claims to check. Groq's stronger
 * model first (falling back to the small planner model when rate-limited),
 * then Mistral. Null when neither is configured: the research then runs
 * without planning, still reading the pages it finds.
 */
function defaultThinker() {
  if (config.groqApiKey) {
    const client = new Groq({ apiKey: config.groqApiKey });
    const ask = (prompt, maxTokens) => (model) => client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: maxTokens,
    });
    return async (prompt, maxTokens) => {
      try {
        const completion = await withGroqModel(client, config.researchModel, ask(prompt, maxTokens));
        return completion.choices?.[0]?.message?.content || "";
      } catch (err) {
        if (!config.searchPlannerModel || config.searchPlannerModel === config.researchModel) throw err;
        logger.warn("research.model.fallback", { from: config.researchModel, to: config.searchPlannerModel, error: err.message });
        const completion = await withGroqModel(client, config.searchPlannerModel, ask(prompt, maxTokens));
        return completion.choices?.[0]?.message?.content || "";
      }
    };
  }
  if (config.mistralApiKey) {
    return (prompt, maxTokens) => mistralAdapter.complete([{ role: "user", content: prompt }], { temperature: 0.2, maxTokens });
  }
  return null;
}

// ── Progress ────────────────────────────────────────────────────────────────

/**
 * Keeps the activity log the browser shows, and reports a full snapshot after
 * every change (small, and it spares the client any merging).
 */
function createProgress({ onProgress, onStatus }) {
  const startedAt = Date.now();
  const state = { phase: "planning", angles: [], steps: [], sources: 0, pagesRead: 0, queries: 0 };
  const snapshot = () => ({ ...state, angles: [...state.angles], steps: state.steps.map((s) => ({ ...s })), elapsedMs: Date.now() - startedAt });
  const emit = () => { try { onProgress?.(snapshot()); } catch (err) { logger.warn("research.progress.failed", { error: err.message }); } };
  return {
    start(id, label, detail = "", phase = id) {
      state.phase = phase;
      state.steps.push({ id, label, detail, status: "active" });
      onStatus?.(`${label}…`);
      emit();
    },
    finish(id, detail) {
      const step = [...state.steps].reverse().find((s) => s.id === id && s.status === "active");
      if (step) {
        step.status = "done";
        if (detail != null) step.detail = detail;
      }
      emit();
    },
    set(fields) { Object.assign(state, fields); },
    snapshot,
  };
}

// ── Running searches and reading pages ──────────────────────────────────────

async function inPool(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await run(items[i], i) }; }
      catch (error) { results[i] = { ok: false, error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const shortList = (queries, max = 3) => {
  const shown = queries.slice(0, max).map((q) => `“${q}”`).join(" · ");
  return queries.length > max ? `${shown} +${queries.length - max} more` : shown;
};

/**
 * Run the research.
 *
 * @param {string} query the user's question
 * @param {object} [options] overrides for DEFAULTS, plus:
 * @param {(msg: string) => void} [options.onStatus] one-line progress, for older clients
 * @param {(snapshot: object) => void} [options.onProgress] the full activity log, after every step
 * @param {string} [options.history] recent conversation, to resolve follow-up questions
 * @param {object} [options.clock] the user's clock (clockService)
 * @param {Function} [options.searchFn] query -> results (tests)
 * @param {Function} [options.plannerFn] (prompt, maxTokens) -> reply text (tests); null disables planning
 * @param {Function} [options.readFn] url -> page text or null (tests)
 * @returns {Promise<{context: string, results: object[], rounds: number, queries: string[], angles: string[], claims: object[]}>}
 */
async function performAgenticSearch(query, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const startedAt = Date.now();
  const timeLeft = () => opts.deadlineMs - (Date.now() - startedAt);
  const search = opts.searchFn || ((q) => searchForResearch(q, { clock: opts.clock }));
  const readPage = opts.readFn || ((url) => fetchPageText(url));
  const rawThink = "plannerFn" in options ? options.plannerFn : defaultThinker();
  const think = rawThink && ((prompt, maxTokens) => withTimeout(
    Promise.resolve().then(() => rawThink(prompt, maxTokens)),
    Math.max(3000, Math.min(THINK_TIMEOUT_MS, timeLeft() - 10000)),
    "The research model took too long",
  ));
  const today = describeClock(opts.clock || {}).date;
  const progress = createProgress(opts);
  const registry = new SourceRegistry();
  const usedQueries = [];
  let rounds = 0;
  let fetchedPages = 0;
  const syncCounts = () => progress.set({ sources: registry.size, pagesRead: registry.pagesRead, queries: usedQueries.length });

  // ── 1. Plan ───────────────────────────────────────────────────────────────
  let plan = parseResearchPlan("", query, opts);
  if (think) {
    progress.start("plan", "Planning the research");
    try {
      plan = parseResearchPlan(await think(PLAN_PROMPT({ query, today, history: opts.history, maxAngles: opts.maxAngles, queriesPerAngle: opts.queriesPerAngle }), 700), query, opts);
    } catch (err) {
      logger.warn("research.plan.failed", { error: err.message });
    }
    progress.set({ angles: plan.angles.map((a) => a.question) });
    progress.finish("plan", `${plan.angles.length} ${plan.angles.length === 1 ? "angle" : "angles"} to research`);
  } else {
    progress.set({ angles: plan.angles.map((a) => a.question) });
  }

  // Terms each angle's evidence is judged by.
  const termsFor = (texts) => keyTerms([query, ...texts].join(" "));
  let angleTerms = plan.angles.map((a) => termsFor([a.question, ...a.queries]));

  const runSearches = async (jobs) => {
    const outcomes = await inPool(jobs, opts.searchConcurrency, (job) => search(job.query));
    let found = 0;
    outcomes.forEach((outcome, i) => {
      if (outcome.ok) found += registry.add(outcome.value, jobs[i]);
      else logger.warn("research.search.failed", { query: jobs[i].query, error: outcome.error?.message });
    });
    usedQueries.push(...jobs.map((j) => j.query));
    syncCounts();
    return found;
  };

  // Reads the most promising pages that came back without their text.
  const readMissing = async (limit) => {
    const budget = Math.min(limit, opts.readPages - fetchedPages);
    if (budget <= 0 || timeLeft() < 15000) return 0;
    const unread = registry.list
      .filter((s) => s.text.length < 400 && !s.fetched)
      .map((s) => ({ s, score: assess(s, [...s.angles].reduce((t, a) => new Set([...t, ...(angleTerms[a] || [])]), keyTerms(query))).score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, budget)
      .map(({ s }) => s);
    if (!unread.length) return 0;
    progress.start("read", `Reading ${unread.length} ${unread.length === 1 ? "page" : "pages"}`, unread.slice(0, 3).map((s) => domainOf(s.url)).join(" · "), "reading");
    unread.forEach((s) => { s.fetched = true; });
    fetchedPages += unread.length;
    const outcomes = await inPool(unread, 5, (s) => readPage(s.url));
    let read = 0;
    outcomes.forEach((outcome, i) => {
      if (outcome.ok && typeof outcome.value === "string" && outcome.value.length >= 400) {
        unread[i].text = outcome.value;
        read += 1;
      }
    });
    syncCounts();
    progress.finish("read", `${read} of ${unread.length} opened`);
    return read;
  };

  // ── 2–4. Search, read, reflect ────────────────────────────────────────────
  let jobs = plan.angles.flatMap((a, angle) => a.queries.map((q) => ({ query: q, angle })));
  // Verification gets its own share of the query budget.
  const searchBudget = Math.max(1, opts.maxQueries - (think ? opts.verifyClaims : 0));

  for (let round = 0; round < opts.maxRounds; round += 1) {
    const batch = jobs.slice(0, searchBudget - usedQueries.length);
    if (!batch.length || timeLeft() <= 0) break;
    rounds += 1;

    const id = `search-${round}`;
    progress.start(id, round === 0 ? `Searching ${plan.angles.length > 1 ? `${plan.angles.length} angles` : "the web"}` : "Following up", shortList(batch.map((j) => j.query)), "searching");
    const found = await runSearches(batch);
    progress.finish(id, `${found} new ${found === 1 ? "source" : "sources"} · ${registry.size} in total`);

    await readMissing(round === 0 ? 8 : 4);

    const roundsLeft = opts.maxRounds - round - 1;
    const queriesLeft = searchBudget - usedQueries.length;
    if (!think || roundsLeft <= 0 || queriesLeft <= 0 || timeLeft() < 30000) break;

    progress.start("reflect", "Looking for gaps", "", "reflecting");
    const digest = plan.angles.map((a, i) => {
      const top = registry.list
        .filter((s) => s.angles.has(i))
        .map((s) => ({ s, ...assess(s, angleTerms[i]) }))
        .sort((x, y) => y.score - x.score)
        .slice(0, 3);
      const lines = top.length
        ? top.map(({ s, passages }) => `- ${s.title || domainOf(s.url)} (${domainOf(s.url)}${s.published ? `, ${String(s.published).slice(0, 10)}` : ""}): ${(passages[0] || "").replace(/\s+/g, " ").slice(0, 280)}`)
        : ["- (nothing useful found)"];
      return `Angle ${i + 1}: ${a.question}\n${lines.join("\n")}`;
    }).join("\n\n");

    let verdict;
    try {
      verdict = parseGaps(await think(REFLECT_PROMPT({ query, brief: plan.brief, digest, budget: Math.min(opts.followUpQueries, queriesLeft) }), 400), plan.angles.length, Math.min(opts.followUpQueries, queriesLeft));
    } catch (err) {
      logger.warn("research.reflect.failed", { error: err.message });
      progress.finish("reflect", "Skipped");
      break;
    }
    const done = new Set(usedQueries.map((q) => q.toLowerCase()));
    const gaps = verdict.gaps.filter((g) => !done.has(g.query.toLowerCase()));
    if (verdict.sufficient || !gaps.length) {
      progress.finish("reflect", "The evidence covers the question");
      break;
    }
    progress.finish("reflect", `Missing: ${gaps.map((g) => g.missing || g.query).slice(0, 3).join("; ")}`);
    logger.info("research.followUp", { gaps });

    // A gap no angle covers becomes an angle of its own.
    jobs = gaps.map((g) => {
      if (g.angle >= 0) return { query: g.query, angle: g.angle };
      if (plan.angles.length < opts.maxAngles + 2) {
        plan.angles.push({ question: g.missing || g.query, queries: [g.query] });
        angleTerms.push(termsFor([g.missing, g.query]));
        progress.set({ angles: plan.angles.map((a) => a.question) });
        return { query: g.query, angle: plan.angles.length - 1 };
      }
      return { query: g.query, angle: 0 };
    });
    angleTerms = angleTerms.map((t, i) => (jobs.some((j) => j.angle === i) ? new Set([...t, ...termsFor(jobs.filter((j) => j.angle === i).map((j) => j.query))]) : t));
  }

  // ── 5. Verify ─────────────────────────────────────────────────────────────
  let claims = [];
  if (think && opts.verifyClaims > 0 && registry.size >= 2 && timeLeft() > 25000) {
    progress.start("verify", "Cross-checking key claims", "", "verifying");
    const candidates = registry.list
      .map((s) => ({ s, ...assess(s, keyTerms([query, ...plan.angles.map((a) => a.question)].join(" "))) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    const ids = new Map(candidates.map(({ s }, i) => [`S${i + 1}`, s]));
    const digest = candidates.map(({ s, passages }, i) =>
      `S${i + 1} ${s.title || domainOf(s.url)} (${domainOf(s.url)}${s.published ? `, ${String(s.published).slice(0, 10)}` : ""}): ${passages.join(" … ").replace(/\s+/g, " ").slice(0, 450)}`
    ).join("\n");
    try {
      const limit = Math.min(opts.verifyClaims, Math.max(0, opts.maxQueries - usedQueries.length));
      claims = limit ? parseClaims(await think(VERIFY_PROMPT({ query, digest, limit }), 500), ids, limit) : [];
    } catch (err) {
      logger.warn("research.verify.failed", { error: err.message });
    }
    if (claims.length) {
      progress.finish("verify", `Checking ${claims.length} ${claims.length === 1 ? "claim" : "claims"} independently`);
      progress.start("verify-search", "Searching independent sources", shortList(claims.map((c) => c.query)), "verifying");
      await runSearches(claims.map((c, i) => ({ query: c.query, claim: i })));
      await readMissing(4);
      progress.finish("verify-search", `${claims.length} ${claims.length === 1 ? "claim" : "claims"} checked`);
    } else {
      progress.finish("verify", "No disputed claims found");
    }
  }

  // ── 6. Choose and number the sources ──────────────────────────────────────
  const claimTerms = claims.map((c) => termsFor([c.claim, c.query]));
  const buckets = [
    // Each claim's independent check first: that evidence is the point of it.
    ...claims.map((c, i) => registry.list.filter((s) => s.claims.has(i)).map((s) => ({ s, ...assess(s, claimTerms[i]) }))),
    ...plan.angles.map((_, i) => registry.list.filter((s) => s.angles.has(i)).map((s) => ({ s, ...assess(s, angleTerms[i]) }))),
  ].map((bucket) => bucket.sort((a, b) => b.score - a.score));

  const chosen = [];
  const taken = new Set();
  let chars = 0;
  const cursor = buckets.map(() => 0);
  for (let moved = true; moved && chosen.length < opts.maxSources;) {
    moved = false;
    for (let b = 0; b < buckets.length && chosen.length < opts.maxSources; b += 1) {
      while (cursor[b] < buckets[b].length && taken.has(buckets[b][cursor[b]].s)) cursor[b] += 1;
      const pick = buckets[b][cursor[b]];
      if (!pick) continue;
      cursor[b] += 1;
      moved = true;
      const size = pick.passages.join("\n").length + 200;
      if (chosen.length && chars + size > opts.contextChars) continue;
      taken.add(pick.s);
      chosen.push(pick);
      chars += size;
    }
  }
  // A claim's original sources belong in the report too, so the writer can
  // compare them with the independent check.
  for (const claim of claims) {
    for (const s of claim.sources) {
      if (taken.has(s) || chosen.length >= opts.maxSources + 4) continue;
      taken.add(s);
      chosen.push({ s, ...assess(s, termsFor([claim.claim])) });
    }
  }
  const numberOf = new Map(chosen.map(({ s }, i) => [s, i + 1]));

  progress.start("write", "Writing the report", `${chosen.length} sources · ${usedQueries.length} searches · ${registry.pagesRead} pages read`, "writing");

  logger.info("research.done", {
    angles: plan.angles.length,
    rounds,
    queries: usedQueries.length,
    sources: registry.size,
    pagesRead: registry.pagesRead,
    chosen: chosen.length,
    claims: claims.length,
    ms: Date.now() - startedAt,
  });

  return {
    context: buildContext({ query, today, plan, chosen, numberOf, claims, registry }),
    compactContext: buildContext({ query, today, plan, chosen, numberOf, claims, registry, compact: true }),
    results: chosen.map(({ s }) => ({ title: s.title || domainOf(s.url), url: s.url, published: s.published, snippet: s.snippet })),
    rounds,
    queries: usedQueries,
    angles: plan.angles.map((a) => a.question),
    claims: claims.map((c) => ({ claim: c.claim, query: c.query })),
    progress: progress.snapshot(),
  };
}

const dateLabel = (published) => {
  const t = Date.parse(published || "");
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

// The compact context's budget for its sources: with the lean prompt it
// leaves room for a full report inside Groq's ~12k-token request cap.
const COMPACT_SOURCE_CHARS = 14000;

/**
 * What the writing model sees: the plan, every chosen source once under one
 * number with its best passages, the angles that came up short, and the
 * claims to judge. One numbering throughout, and the same order as the
 * source cards the browser shows, so [n] always means the same page.
 *
 * `compact` keeps every source and number but quotes only each one's best
 * passage, shortened, for a writer with a small request budget.
 */
function buildContext({ query, today, plan, chosen, numberOf, claims, registry, compact = false }) {
  const quoteLimit = compact ? Math.min(450, Math.max(160, Math.floor(COMPACT_SOURCE_CHARS / Math.max(chosen.length, 1)) - 140)) : Infinity;
  const quotes = (passages) => (compact
    ? passages.slice(0, 1).map((p) => (p.length > quoteLimit ? `${p.slice(0, quoteLimit).trimEnd()}…` : p))
    : passages);
  const parts = [
    `**DeepSearch research** — ${today}`,
    `**Question**: "${query}"${plan.brief ? `\n**What a complete answer has to establish**: ${plan.brief}` : ""}`,
  ];

  const coverage = plan.angles.map((a, i) => {
    const nums = chosen.filter(({ s }) => s.angles.has(i)).map(({ s }) => numberOf.get(s));
    return { question: a.question, nums };
  });
  parts.push(`**Research plan**:\n${coverage.map((c, i) => `${i + 1}. ${c.question}${c.nums.length ? ` — sources ${c.nums.slice(0, 8).map((n) => `[${n}]`).join(" ")}` : " — no good sources found"}`).join("\n")}`);

  const thin = coverage.filter((c) => !c.nums.length);
  if (thin.length) {
    parts.push(`**Coverage gaps**: the research found no solid evidence for: ${thin.map((c) => `"${c.question}"`).join("; ")}. Say so plainly in the report rather than filling the gap from memory.`);
  }

  if (chosen.length) {
    parts.push(`**SOURCES** (${chosen.length}, from ${registry.size} found; cite them inline as [n]):\n\n${chosen.map(({ s, passages }) => {
      const meta = [domainOf(s.url), dateLabel(s.published) && `published ${dateLabel(s.published)}`].filter(Boolean).join(" · ");
      return `[${numberOf.get(s)}] ${s.title || domainOf(s.url)} — ${meta}\n${s.url}\n${quotes(passages).map((p) => `> ${p.replace(/\n+/g, " ")}`).join("\n")}`;
    }).join("\n\n")}`);
  } else {
    parts.push("**SOURCES**: none — the searches returned nothing usable. Say so, and do not present anything as a sourced finding.");
  }

  if (claims.length) {
    parts.push(`**CLAIMS CROSS-CHECKED** — for each, judge from the sources whether the independent check confirms it, contradicts it, or doesn't address it, and say which in the report:\n${claims.map((c, i) => {
      const original = c.sources.map((s) => numberOf.get(s)).filter(Boolean);
      const checks = chosen.filter(({ s }) => s.claims.has(i)).map(({ s }) => numberOf.get(s));
      return `- "${c.claim}"${original.length ? ` — from ${original.map((n) => `[${n}]`).join(" ")}` : ""}; independent check: ${checks.length ? checks.map((n) => `[${n}]`).join(" ") : "found nothing"}`;
    }).join("\n")}`);
  }

  return parts.join("\n\n---\n\n");
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

module.exports = {
  performAgenticSearch,
  DEFAULTS,
  // exported for tests
  parsePlan,
  parseResearchPlan,
  parseGaps,
  parseClaims,
  normalizeUrl,
  dedupeResults,
  SourceRegistry,
};
