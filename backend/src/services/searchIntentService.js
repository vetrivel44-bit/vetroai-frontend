// Should this message be searched on the web before it is answered?
//
// Primary: Perplexity's pplx-decider-v1.3 on AI Router — a model built for
// fast classification. It reads the message with today's date and the last few
// turns, and answers SEARCH or NO.
//
// Fallback 1: Groq's SEARCH_PLANNER_MODEL (llama-3.1-8b-instant), used when
// AI Router is unavailable.
//
// Fallback 2: the word list (liveInfoIntent), used when both models fail or
// are slow, and always used alone in the modes made for code and writing.

const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const { withGroqModel, quietReasoning } = require("../utils/groqModel");
const { clockLine } = require("./clockService");
const { searchQueryFor } = require("./searchGrounding");
const { needsLiveInfo, TIMELESS_MODES, plainReading, isAboutSelf, isSmallTalk, isFollowUpRequest } = require("./liveInfoIntent");
const decider = require("./deciderService");

// Waiting longer than this for a yes/no would hold up every reply.
const DECIDE_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

const INSTRUCTIONS = `You decide whether an AI assistant must search the web before replying to the user's latest message. The assistant's own knowledge is out of date: it stops about two years before today.

Answer SEARCH when a good reply depends on facts that may have changed or that the assistant may not know: news and events; prices, rates, fees and salaries; who currently holds a job, office or title; sports results and schedules; weather; phones, gadgets, apps, AI models and other products or releases; specific companies, people, places, shows or films named in the message; laws, exams, admissions and government schemes; rankings, statistics and "best"/"top" lists; local businesses, addresses and timings.

Answer NO when the reply needs no outside facts: questions to the assistant about itself (its name, who made it, what model it is, what it can do) — it already knows those; greetings, thanks, feelings and small talk ("I am happy", "I'm bored", "good night"); jokes, stories, poems and other writing; translating, summarising or rewriting text; code, maths and logic; explaining well-established concepts (what DBMS is, how photosynthesis works); opinions, advice and plans that don't depend on current facts; questions about this conversation or an attached file.

People often type in text-speak: "u" is "you", "ur" is "your", "r" is "are" — so "Ur name" asks the assistant its name, and is not about the ancient city of Ur.

Reply with exactly one word: SEARCH or NO.`;

let client = null;
let clientKey = null;
function groqClient() {
  if (!config.groqApiKey) return null;
  if (!client || clientKey !== config.groqApiKey) {
    client = new Groq({ apiKey: config.groqApiKey });
    clientKey = config.groqApiKey;
  }
  return client;
}

/** Asks the model; resolves to the raw reply text. Tests replace it. */
let askModel = async (messages, { maxTokens = 16 } = {}) => {
  const groq = groqClient();
  if (!groq) throw new Error("no Groq key");
  const completion = await withGroqModel(groq, config.searchPlannerModel, (model) => groq.chat.completions.create({
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    ...quietReasoning(model),
  }));
  return completion?.choices?.[0]?.message?.content || "";
};

const cache = new Map();

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no decision within ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const turnText = (m) => (typeof m?.content === "string" ? m.content : "").replace(/\s+/g, " ").trim();

// The message in plain words when it was typed in text-speak, so the judge
// reads "wat is d weather 2day" as "what is d weather today".
function plainWords(q) {
  const plain = plainReading(q);
  return plain.toLowerCase() !== q.replace(/\s+/g, " ").trim().toLowerCase() ? `\n(In plain words: ${plain.slice(0, 1500)})` : "";
}

/**
 * Whether to search the web for `query` before answering it.
 * `history` is the conversation before it ({ role, content }), `mode` the chat
 * mode, `clock` the user's clock (for "today").
 * Resolves to { search, by }: by is "model" when the model decided, "rules"
 * when the word list did.
 */
async function decideSearch({ query, history = [], mode, clock } = {}) {
  const q = String(query || "").trim();
  const rules = (reason) => ({ search: needsLiveInfo(q, { mode }), by: "rules", reason });
  // Asking the assistant about itself ("Ur name", "who r u"), small talk
  // ("how r u", "thank u") and asking for the last answer another way ("in
  // tamil", "in short", "give eg") are never searched, and need no model.
  if (!q || isAboutSelf(q) || isSmallTalk(q) || isFollowUpRequest(q)) return { search: false, by: "rules" };
  // Coding, writing and similar modes: only clearly-current questions search,
  // which the word list knows well enough.
  if (TIMELESS_MODES.has(String(mode || "").toLowerCase())) return rules("mode");

  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && turnText(m))
    .slice(-4)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${turnText(m).slice(0, 300)}`);
  const key = `${mode || ""}\n${recent.slice(-2).join("\n")}\n${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { search: hit.search, by: "model", cached: true };

  // ── Try Perplexity Decider first (AI Router) ──────────────────────────────
  try {
    const clockStr = clockLine(clock || {});
    const result = await withTimeout(decider.decideSearchIntent(q, recent, clockStr), DECIDE_TIMEOUT_MS);
    if (result !== null) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, { search: result, at: Date.now() });
      logger.info("searchIntent.decider", { search: result });
      return { search: result, by: "decider" };
    }
    // null = unclear reply, fall through to Groq
  } catch (err) {
    logger.warn("searchIntent.deciderFailed", { error: err.message });
  }

  // ── Fallback: Groq model ─────────────────────────────────────────────────
  const messages = [
    { role: "system", content: `${INSTRUCTIONS}\n\n${clockLine(clock || {})}` },
    {
      role: "user",
      content: `${recent.length ? `Conversation so far:\n${recent.join("\n")}\n\n` : ""}Latest message: ${q.slice(0, 1500)}${plainWords(q)}`,
    },
  ];
  try {
    const reply = String(await withTimeout(askModel(messages), DECIDE_TIMEOUT_MS)).toUpperCase();
    const search = /\bSEARCH\b/.test(reply) ? true : /\bNO\b/.test(reply) ? false : null;
    if (search === null) return rules("unclear reply");
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { search, at: Date.now() });
    return { search, by: "model" };
  } catch (err) {
    logger.warn("searchIntent.fallbackToRules", { error: err.message });
    return rules(err.message);
  }
}

// A follow-up ("Is the reviews good for this movie", "and his wife?") searched
// on its own words finds pages about something else. The same small model
// rewrites it into a search that names the subject, from the conversation.
const REWRITE_TIMEOUT_MS = 2500;
const REWRITE_INSTRUCTIONS = `Rewrite the user's latest message as ONE self-contained web search query, using the conversation to fill in what it refers to: "it", "this movie", "he", "the price", "total", "reviews" and the like become the actual name being discussed (the film, person, team, product or place).

- If the latest message is already self-contained, or starts a new subject, return it unchanged.
- Keep names, numbers, years and the user's language; fix text-speak ("2day" → "today").
- Short and specific, like something typed into a search engine. No answer, no explanation, no quotes.

Reply with the query only.`;
const rewriteCache = new Map();

function cleanQuery(reply, fallback) {
  const line = String(reply || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  const q = line.replace(/^(search\s*)?query\s*:\s*/i, "").replace(/^["'`“”]+|["'`“”]+$/g, "").trim();
  return q.length >= 2 && q.length <= 200 ? q : fallback;
}

/**
 * The web search to run for `query`: a follow-up rewritten (by the model, or
 * the word rules when it is unavailable) to name what it is about. A message
 * with no earlier question is searched as it is.
 * Resolves to { query, by }: by is "model", "rules" or "as-is".
 */
async function searchQueryForTurn({ query, history = [], clock } = {}) {
  const q = String(query || "").trim();
  const turns = (Array.isArray(history) ? history : []).filter((m) => (m?.role === "user" || m?.role === "assistant") && turnText(m));
  const rules = searchQueryFor(q, turns);
  if (!q || !turns.some((m) => m.role === "user") || q.split(/\s+/).length > 25) return { query: rules, by: rules === q ? "as-is" : "rules" };

  const recent = turns.slice(-6).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${turnText(m).slice(0, m.role === "user" ? 300 : 200)}`);
  const key = `${recent.join("\n")}\n${q.toLowerCase()}`;
  const hit = rewriteCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { query: hit.query, by: "model", cached: true };

  // ── Try Perplexity Decider first ─────────────────────────────────────────
  try {
    const clockStr = clockLine(clock || {});
    const rewritten = await withTimeout(decider.rewriteQuery(q, recent, clockStr), REWRITE_TIMEOUT_MS);
    if (rewritten) {
      if (rewriteCache.size >= CACHE_MAX) rewriteCache.delete(rewriteCache.keys().next().value);
      rewriteCache.set(key, { query: rewritten, at: Date.now() });
      logger.info("searchIntent.deciderRewrite", { original: q.slice(0, 80), rewritten: rewritten.slice(0, 80) });
      return { query: rewritten, by: "decider" };
    }
  } catch (err) {
    logger.warn("searchIntent.deciderRewriteFailed", { error: err.message });
  }

  // ── Fallback: Groq model ─────────────────────────────────────────────────
  try {
    const reply = await withTimeout(askModel([
      { role: "system", content: `${REWRITE_INSTRUCTIONS}\n\n${clockLine(clock || {})}` },
      { role: "user", content: `Conversation so far:\n${recent.join("\n")}\n\nLatest message: ${q.slice(0, 600)}${plainWords(q)}` },
    ], { maxTokens: 60 }), REWRITE_TIMEOUT_MS);
    const rewritten = cleanQuery(reply, null);
    if (!rewritten) return { query: rules, by: "rules", reason: "unclear reply" };
    if (rewriteCache.size >= CACHE_MAX) rewriteCache.delete(rewriteCache.keys().next().value);
    rewriteCache.set(key, { query: rewritten, at: Date.now() });
    return { query: rewritten, by: "model" };
  } catch (err) {
    logger.warn("searchIntent.rewriteFallbackToRules", { error: err.message });
    return { query: rules, by: "rules", reason: err.message };
  }
}

module.exports = {
  decideSearch,
  searchQueryForTurn,
  DECIDE_TIMEOUT_MS,
  // Tests stand in for the model, and start from an empty cache.
  setModel: (fn) => { askModel = fn; },
  clearCache: () => { cache.clear(); rewriteCache.clear(); },
};
