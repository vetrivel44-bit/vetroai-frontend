// Should this message be searched on the web before it is answered?
//
// With auto-search on, a word list used to decide (liveInfoIntent). Word lists
// can't read a message: "I am happy" was searched, the results were about
// Pharrell Williams' song "Happy", and the reply explained the song instead of
// answering the user. So a small, fast model (Groq's SEARCH_PLANNER_MODEL,
// llama-3.1-8b-instant by default) reads the message — with today's date and
// the last few turns, so "and in 2025?" is understood — and answers SEARCH or
// NO. The word list is only the fallback when that model is unavailable or
// slow, and still decides alone in the modes made for code and writing.

const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const { withGroqModel, quietReasoning } = require("../utils/groqModel");
const { clockLine } = require("./clockService");
const { needsLiveInfo, TIMELESS_MODES, ABOUT_SELF } = require("./liveInfoIntent");

// Waiting longer than this for a yes/no would hold up every reply.
const DECIDE_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

const INSTRUCTIONS = `You decide whether an AI assistant must search the web before replying to the user's latest message. The assistant's own knowledge is out of date: it stops about two years before today.

Answer SEARCH when a good reply depends on facts that may have changed or that the assistant may not know: news and events; prices, rates, fees and salaries; who currently holds a job, office or title; sports results and schedules; weather; phones, gadgets, apps, AI models and other products or releases; specific companies, people, places, shows or films named in the message; laws, exams, admissions and government schemes; rankings, statistics and "best"/"top" lists; local businesses, addresses and timings.

Answer NO when the reply needs no outside facts: greetings, thanks, feelings and small talk ("I am happy", "I'm bored", "good night"); jokes, stories, poems and other writing; translating, summarising or rewriting text; code, maths and logic; explaining well-established concepts (what DBMS is, how photosynthesis works); opinions, advice and plans that don't depend on current facts; questions about this conversation or an attached file.

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
let askModel = async (messages) => {
  const groq = groqClient();
  if (!groq) throw new Error("no Groq key");
  const completion = await withGroqModel(groq, config.searchPlannerModel, (model) => groq.chat.completions.create({
    model,
    messages,
    temperature: 0,
    max_tokens: 16,
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
  if (!q || ABOUT_SELF.test(q)) return { search: false, by: "rules" };
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

  const messages = [
    { role: "system", content: `${INSTRUCTIONS}\n\n${clockLine(clock || {})}` },
    {
      role: "user",
      content: `${recent.length ? `Conversation so far:\n${recent.join("\n")}\n\n` : ""}Latest message: ${q.slice(0, 1500)}`,
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

module.exports = {
  decideSearch,
  DECIDE_TIMEOUT_MS,
  // Tests stand in for the model, and start from an empty cache.
  setModel: (fn) => { askModel = fn; },
  clearCache: () => cache.clear(),
};
