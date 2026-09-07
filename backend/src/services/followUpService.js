// Related-question generation, in the spirit of Perplexity's "Related" list.
//
// The old version asked for "4 concise follow-up questions" and fed the model
// only the first 600 characters of the answer. Both problems pushed it toward
// the same four shapes every time — "What are the benefits of X?", "How does X
// work?" — because a model that cannot see the specifics has nothing to be
// specific about.
//
// What makes these read as real questions is: the model sees the whole answer,
// it is told to anchor each question to something concrete in it, it is shown
// what a generic question looks like so it can avoid one, and anything that
// still comes back templated is filtered out here.

const logger = require("../utils/logger");

// Question shapes that carry no information about the actual answer. If a
// suggestion matches one of these it would have been produced for any topic,
// which is exactly the "fixed format" complaint.
const GENERIC_PATTERNS = [
  /^what (are|is) the (main |key |primary |potential )?(benefits?|advantages?|pros)\b/i,
  /^what (are|is) the (main |key |primary |potential )?(challenges?|drawbacks?|disadvantages?|cons|limitations?)\b/i,
  /^how does .{0,40}\bwork\??$/i,
  /^can you (tell me more|explain|elaborate)\b/i,
  /^(tell me|explain) more\b/i,
  /^what (else|other)\b.{0,30}\?$/i,
  /^what (are|is) the (future|next steps?|implications?)\b/i,
  /^why is .{0,30}important\??$/i,
  /^what should i know\b/i,
  /^(any|are there) (other )?(examples?|tips?)\??$/i,
  /^how can i (learn|get started|use) (more )?(about )?(this|it)\b/i,
  /^what (is|are) the best (next step|way|approach)\b/i,
  /^can you (give|show) me (a|an|some|another)\b/i,
  /^what should i (watch|look) (out )?for\b/i,
  /^what('s| is) next\b/i,
  /^how (do|would) i (start|begin|apply) (this|it)\b/i,
  /\bmore simply\?$/i,
];

const isGeneric = (q) => GENERIC_PATTERNS.some((rx) => rx.test(q.trim()));

// Words too common to prove a question is about anything in particular.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "were", "you", "your", "yours", "this", "that", "these", "those",
  "with", "from", "into", "about", "what", "when", "where", "which", "who", "whom", "why", "how",
  "can", "could", "should", "would", "will", "shall", "may", "might", "must", "does", "did", "done",
  "have", "has", "had", "its", "it's", "not", "but", "any", "all", "some", "more", "most", "other",
  "than", "then", "there", "their", "them", "they", "she", "him", "her", "his", "our", "ours",
  "get", "got", "make", "made", "use", "used", "using", "give", "given", "take", "want", "need",
  "one", "two", "also", "very", "just", "like", "such", "each", "example", "examples", "practical",
  "simply", "simple", "explain", "explained", "tell", "know", "watch", "out", "next", "step", "steps",
  "best", "good", "bad", "thing", "things", "way", "ways", "help", "work", "works", "working",
  "here", "much", "many", "still", "over", "under", "between", "because", "before", "after", "while",
]);

// Words in a string that actually carry topic meaning. Internal dots and
// dashes are kept so "n_distinct", "pg-bouncer" and "node.js" survive as one
// token, but trailing ones are trimmed — otherwise "differential." from the
// answer would never match "differential" in a question.
const TOKEN_RE = /[a-z][a-z0-9_.-]*/g;
const trimToken = (w) => w.replace(/^[._-]+|[._-]+$/g, "");

function tokenize(text) {
  return (String(text).toLowerCase().match(TOKEN_RE) || [])
    .map(trimToken)
    .filter((w) => w.length >= 3);
}

function contentWords(text) {
  return new Set(tokenize(text).filter((w) => !STOPWORDS.has(w)));
}

const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// The failure that produced "Can you explain Can you explain Apk more simply
// more simply?": a weak model wraps a template around the question it was
// given, so the user's own words come back nested inside the suggestion.
function repeatsQuery(question, userQuery) {
  const u = normalise(userQuery);
  if (u.length < 12) return false;
  return normalise(question).includes(u);
}

// A question is anchored when it engages with something the ANSWER introduced.
// Matching the user's own topic word is not enough: "Can you tell the steps
// followed by car?" contains "car", but so would every template built from the
// prompt — which is precisely the patterned output being complained about. The
// anchor set is therefore the answer's vocabulary MINUS whatever the user
// already said, so only a question reaching past the prompt survives.
function anchorSet(answer, userQuery = "") {
  const asked = contentWords(userQuery);
  const out = new Set();
  for (const w of contentWords(answer)) {
    if (!asked.has(w)) out.add(w);
  }
  return out;
}

function isAnchored(question, answerWords) {
  // An answer that added nothing beyond the prompt gives nothing to anchor to;
  // don't reject everything in that case.
  if (!answerWords || answerWords.size === 0) return true;
  for (const w of contentWords(question)) {
    if (answerWords.has(w)) return true;
  }
  return false;
}

// The terms the ANSWER introduced that the question did not already contain.
// This is the heart of it: if someone asks "car" and the reply talks about
// combustion, transmission and torque, those three words are what the reply
// actually added. Handing them to the model turns "write a good question" into
// "write a question about combustion", which a template cannot satisfy — and
// it works even when only a small model is available, which is when the
// templated output showed up in the first place.
function keyTerms(answer, userQuery = "", limit = 12) {
  const asked = contentWords(userQuery);
  const counts = new Map();
  for (const w of tokenize(answer)) {
    if (w.length < 4 || STOPWORDS.has(w) || asked.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  // Something named once in a short reply still matters, so rank by count but
  // keep singletons rather than demanding repetition.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

// Normalised form used only for duplicate detection.
const dedupeKey = (q) =>
  q.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(the|a|an|of|for|to|in|on|is|are|does|do)\b/g, "").replace(/\s+/g, " ").trim();

function buildPrompt({ userQuery, answer, history, strict = false }) {
  const recent = (history || [])
    .slice(-6)
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const system = `You write the "Related" questions shown under an answer, the way Perplexity does.

HOW TO WRITE THEM
- Anchor every question to something specific that appears in the answer: a name, number, tool, term, tradeoff, or claim. If a question could have been written without reading the answer, it is wrong.
- Do not ask anything the answer already covers. These are the NEXT thing someone would want to know.
- Give four genuinely different angles. Vary across: going deeper on a mechanism, comparing against a named alternative, applying it in practice, and probing a limit, risk, cost, or edge case.
- Phrase them the way a curious person actually types: 5 to 14 words, sentence case, ending in a question mark.
- No numbering, no bullets, no markdown, no preamble.

NEVER produce generic shells like these — they say nothing about the topic:
- "What are the benefits of X?"
- "How does X work?"
- "What are the challenges of X?"
- "Can you tell me more?"

GOOD examples (note how each names something concrete):
- "Why does the planner choose a seq scan over the index here?"
- "How much latency does pgbouncer actually remove at 500 connections?"
- "Would a partial index on status beat the composite one?"
- "What breaks if the replica lags more than 30 seconds?"

Return ONLY a JSON array of exactly 4 strings. No other text.`;

  const terms = keyTerms(answer, userQuery);
  const termLine = terms.length
    ? `\nThese are the specific things the answer raised that the question did not: ${terms.join(", ")}.\nEach of your four questions must engage with at least one of them. A question that uses none of these words is not about this answer, and is wrong.\n`
    : "";

  // Used for the second attempt, when the first came back templated anyway.
  const insist = strict
    ? `\nYour previous attempt was rejected for being generic. Do not restate the user's question in any form. Do not use the frames "Can you explain...", "What are the benefits...", "What should I watch out for...", "Can you give me an example...", or "What is the best next step...". Name a specific thing from the answer in every question.\n`
    : "";

  const user = [
    recent ? `Conversation so far:\n${recent}\n` : "",
    `The user asked: ${userQuery || "(not recorded)"}`,
    "",
    "The answer they just received:",
    answer,
    termLine,
    insist,
  ].filter(Boolean).join("\n");

  return { system, user };
}

// Pulls a clean list of questions out of whatever the model returned.
function parseSuggestions(raw) {
  if (!raw || typeof raw !== "string") return [];
  let items = [];

  // Preferred: a JSON array, possibly wrapped in a code fence or prose.
  const jsonSlice = raw.match(/\[[\s\S]*\]/);
  if (jsonSlice) {
    try {
      const parsed = JSON.parse(jsonSlice[0]);
      if (Array.isArray(parsed)) items = parsed.filter((x) => typeof x === "string");
    } catch { /* fall through to line parsing */ }
  }

  if (!items.length) {
    items = raw
      .split(/\n+/)
      .map((line) => line.replace(/^\s*[-*•]\s*/, "").replace(/^\s*\d+[.)]\s*/, "").trim())
      .filter(Boolean);
  }

  return items;
}

function cleanSuggestions(items, { userQuery = "", answer = "" } = {}) {
  const seen = new Set();
  const out = [];
  const answerWords = answer ? anchorSet(answer, userQuery) : null;

  for (const item of items) {
    // Order matters: strip list markers first, because a quoted question can
    // arrive as `1. "Why ...?"` and the quote is only leading once the "1. "
    // in front of it is gone.
    let q = String(item)
      .replace(/^\s*[-*•]\s*/, "")
      .replace(/^\s*\d+[.)]\s*/, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!q) continue;
    // A stray sentence of preamble is not a question.
    if (!q.endsWith("?")) {
      if (/[.!]$/.test(q) || q.length > 120) continue;
      q += "?";
    }
    if (q.length < 12 || q.length > 120) continue;
    if (isGeneric(q)) continue;
    if (repeatsQuery(q, userQuery)) continue;
    if (!isAnchored(q, answerWords)) continue;

    const key = dedupeKey(q);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === 4) break;
  }

  return out;
}

// `callModel({ system, user, maxTokens, temperature })` must resolve to the raw
// model text. Kept injectable so the controller can supply whichever provider
// it has configured, and so this is testable without a network.
async function generateFollowUps({ userQuery, answer, history, callModel }) {
  const ask = async (strict) => {
    const { system, user } = buildPrompt({ userQuery, answer, history, strict });
    const raw = await callModel({
      system,
      user,
      // Four specific questions need room; the old 120-token cap truncated the
      // fourth one and the JSON array with it.
      maxTokens: 260,
      // High enough to vary the angles, low enough to stay on topic.
      temperature: strict ? 0.6 : 0.8,
    });
    return cleanSuggestions(parseSuggestions(raw), { userQuery, answer });
  };

  let suggestions = await ask(false);

  // One more go when the model leaned on templates, telling it plainly that it
  // did. Showing two good questions beats showing four, but showing none beats
  // showing filler — so this only retries when most were rejected.
  if (suggestions.length < 2) {
    logger.info("followUps.retryStrict", { firstPass: suggestions.length });
    try {
      const second = await ask(true);
      if (second.length > suggestions.length) suggestions = second;
    } catch (err) {
      logger.warn("followUps.retryFailed", { error: err.message });
    }
  }

  if (suggestions.length < 4) {
    logger.info("followUps.partial", { got: suggestions.length });
  }
  return suggestions;
}

module.exports = {
  generateFollowUps,
  buildPrompt,
  parseSuggestions,
  cleanSuggestions,
  isGeneric,
  keyTerms,
  anchorSet,
  repeatsQuery,
  isAnchored,
  contentWords,
  GENERIC_PATTERNS,
};
