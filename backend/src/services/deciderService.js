// Perplexity Decider — a fast classification model (pplx-decider-v1.3) on
// AI Router that answers classification questions in one or two words.
// Used for: search intent, auto-mode, query rewriting, effort picking and
// provider routing.

const { config } = require("../config/env");
const logger = require("../utils/logger");

const DECIDER_MODEL = "perplexity/pplx-decider-v1.3";
// Hard timeout: a classification should be instant; waiting longer holds up the reply.
const DECIDER_TIMEOUT_MS = 3000;

// AI Router serves its decision models at /v1/decisions only: a
// /chat/completions call is refused ("is a decision model. Use POST
// /v1/decisions instead"), which had made every decision below fail.
const base = () => (config.airouterBaseUrl || "https://api.airouter.in/v1").replace(/\/+$/, "");
function endpoint() {
  return `${base()}/chat/completions`;
}

function apiKey() {
  const key = String(config.airouterApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!key) throw new Error("AI Router key not configured (needed for the decider)");
  return key;
}

/**
 * Ask the Perplexity Decider a classification question.
 * @param {string} system  — the classification instructions
 * @param {string} user    — the input to classify
 * @param {{ maxTokens?: number, temperature?: number, timeoutMs?: number }} opts
 * @returns {Promise<string>} the model's reply, trimmed
 */
async function ask(system, user, { maxTokens = 30, temperature = 0, timeoutMs = DECIDER_TIMEOUT_MS } = {}) {
  const key = apiKey();
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "x-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DECIDER_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Decider ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content || "").trim();
}

/**
 * Ask the decider structured questions about `input` (POST /v1/decisions).
 * Each question: { name, type: "predicate" | "choice" | "score",
 * instructions, choices?: [{ value }], levels?: [{ label }] }.
 * Resolves to the answers by name, e.g.
 *   { search: { type: "predicate", probability: 0.97 },
 *     mode: { type: "choice", choice: "code", confidence: 0.99 } }.
 */
async function decide(input, questions, { timeoutMs = DECIDER_TIMEOUT_MS } = {}) {
  const key = apiKey();
  const res = await fetch(`${base()}/decisions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: DECIDER_MODEL, input: String(input || "").slice(0, 4000), questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Decider ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return Object.fromEntries((data.answers || []).map((a, i) => [a.name || questions[i]?.name || String(i), a]));
}

// A multiple-choice decision: the chosen value, or null when unsure.
async function chooseOne(input, name, instructions, values, minConfidence = 0.4) {
  const answers = await decide(input, [{ name, type: "choice", instructions, choices: values.map((value) => ({ value })) }]);
  const answer = answers[name];
  return answer && values.includes(answer.choice) && (answer.confidence ?? 1) >= minConfidence ? answer.choice : null;
}

// The prompts below end "Reply with exactly one word…" for a chat model;
// as decision instructions that line is left off.
const asInstructions = (prompt) => prompt.replace(/\n*Reply with[^\n]*$/i, "").trim();

// ─── 1. SEARCH INTENT ────────────────────────────────────────────────────────
// Replaces the Groq llama model in searchIntentService.

const SEARCH_INTENT_PROMPT = `You decide whether an AI assistant must search the web before replying to the user's latest message. The assistant's own knowledge is out of date.

Answer SEARCH when a good reply depends on facts that may have changed or that the assistant may not know: news and events; prices, rates, fees and salaries; who currently holds a job, office or title; sports results and schedules; weather; phones, gadgets, apps, AI models and other products or releases; specific companies, people, places, shows or films named in the message; laws, exams, admissions and government schemes; rankings, statistics and "best"/"top" lists; local businesses, addresses and timings.

Answer NO when the reply needs no outside facts: questions to the assistant about itself; greetings, thanks, feelings and small talk; jokes, stories, poems and other writing; translating, summarising or rewriting text; code, maths and logic; explaining well-established concepts; opinions, advice and plans that don't depend on current facts; questions about the conversation or an attached file.

Reply with exactly one word: SEARCH or NO.`;

async function decideSearchIntent(query, recentTurns, clock) {
  const context = recentTurns.length
    ? `Conversation so far:\n${recentTurns.join("\n")}\n\n`
    : "";
  const clockLine = clock ? `Today: ${clock}\n` : "";
  const answers = await decide(`${clockLine}${context}Latest message: ${query.slice(0, 1500)}`, [
    { name: "search", type: "predicate", instructions: `${asInstructions(SEARCH_INTENT_PROMPT)}\n\nTrue when the assistant must search the web before replying to the latest message.` },
  ]);
  const p = answers.search?.probability;
  if (typeof p !== "number") return null;
  if (p >= 0.6) return true;
  if (p <= 0.4) return false;
  return null; // unclear — caller falls back to rules
}

// ─── 2. AUTO-MODE ────────────────────────────────────────────────────────────
// Classifies the user's message into the best workflow.

const AUTO_MODE_PROMPT = `Classify the user's message into exactly ONE workflow mode for an AI assistant. Consider any attached file types mentioned.

Modes:
- deep_search: The user wants thorough multi-source research with citations (e.g. "research report on…", "comprehensive analysis of…", "in-depth comparison…").
- analyst: The user attached a data file (CSV, Excel, JSON) or asks to analyse data, make charts, find trends or build a dashboard.
- debugger: The user shares code, asks to write/fix/review code, or describes a programming task.
- summarize: The user asks to summarise, condense, or extract key points from long text or an attached document.
- web_search: The user's question needs current web information but not deep research (a quick lookup: weather, news, prices, scores, "what is X company").
- normal: Conversation, creative writing, advice, translations, general knowledge, or anything that doesn't fit the above.

Reply with exactly one word: deep_search, analyst, debugger, summarize, web_search, or normal.`;

async function decideMode(query, fileNames) {
  const fileInfo = fileNames.length ? `\nAttached files: ${fileNames.join(", ")}` : "";
  const valid = ["deep_search", "analyst", "debugger", "summarize", "web_search", "normal"];
  return chooseOne(`${query.slice(0, 1500)}${fileInfo}`, "mode", asInstructions(AUTO_MODE_PROMPT), valid);
}

// ─── 3. SEARCH QUERY REWRITER ────────────────────────────────────────────────
// Rewrites a follow-up message into a standalone search query.

const REWRITE_PROMPT = `Rewrite the user's latest message as ONE self-contained web search query, using the conversation to fill in what it refers to: "it", "this movie", "he", "the price" and the like become the actual name being discussed.

- If the latest message is already self-contained, or starts a new subject, return it unchanged.
- Keep names, numbers, years and the user's language; fix text-speak ("2day" → "today").
- Short and specific, like something typed into a search engine.

Reply with the query only, nothing else.`;

// A decision model answers questions; it can't write a query. The caller
// (searchIntentService.searchQueryForTurn) goes straight on to its Groq
// rewrite and then its rules, instead of a call that always failed.
// REWRITE_PROMPT stays as the reference wording.
async function rewriteQuery() {
  return null;
}

// ─── 4. SEARCH EFFORT ────────────────────────────────────────────────────────
// Auto-picks quick/balanced/deep/max based on the query complexity.

const EFFORT_PROMPT = `Pick how much web search effort an AI assistant should use to answer this question.

- quick: Simple factual lookup — weather, a score, a price, a single fact, a definition.
- balanced: A normal question that needs a few sources — "best restaurants in Bangalore", "how to fix error X", a person or company overview.
- deep: A complex question needing many sources — comparisons, "pros and cons of X vs Y", market analysis, multi-step research.
- max: Exhaustive research — "comprehensive guide to…", academic-level review, industry analysis with statistics.

Reply with exactly one word: quick, balanced, deep, or max.`;

async function decideEffort(query) {
  return chooseOne(query.slice(0, 1500), "effort", asInstructions(EFFORT_PROMPT), ["quick", "balanced", "deep", "max"]);
}

// ─── 5. PROVIDER ROUTING ────────────────────────────────────────────────────
// Suggests the best backend provider for a query type.

const PROVIDER_PROMPT = `Pick the best AI provider to answer this message. Each has a strength:

- groq: Fast. Best for code, debugging, quick factual answers, and conversations that need speed.
- fable: Creative and thorough. Best for long-form writing, design (HTML/CSS websites), creative stories, and nuanced analysis.
- chatgpt: Versatile. Best for general knowledge, structured explanations, business writing, and balanced answers.
- airouter: Reasoning. Best for math, logic puzzles, step-by-step problem solving, and technical deep-dives.
- gemini: Multimodal and data-heavy. Best for data analysis, charts, long documents, and when the user attached files.

Reply with exactly one word: groq, fable, chatgpt, airouter, or gemini.`;

async function decideProvider(query, fileNames) {
  const fileInfo = fileNames.length ? `\nAttached files: ${fileNames.join(", ")}` : "";
  return chooseOne(`${query.slice(0, 1500)}${fileInfo}`, "provider", asInstructions(PROVIDER_PROMPT), ["groq", "fable", "chatgpt", "airouter", "gemini"]);
}

module.exports = {
  ask,
  decide,
  decideSearchIntent,
  decideMode,
  rewriteQuery,
  decideEffort,
  decideProvider,
  DECIDER_MODEL,
  DECIDER_TIMEOUT_MS,
};
