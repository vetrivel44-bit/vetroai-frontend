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
];

const isGeneric = (q) => GENERIC_PATTERNS.some((rx) => rx.test(q.trim()));

// Normalised form used only for duplicate detection.
const dedupeKey = (q) =>
  q.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(the|a|an|of|for|to|in|on|is|are|does|do)\b/g, "").replace(/\s+/g, " ").trim();

function buildPrompt({ userQuery, answer, history }) {
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

  const user = [
    recent ? `Conversation so far:\n${recent}\n` : "",
    `The user asked: ${userQuery || "(not recorded)"}`,
    "",
    "The answer they just received:",
    answer,
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

function cleanSuggestions(items) {
  const seen = new Set();
  const out = [];

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
  const { system, user } = buildPrompt({ userQuery, answer, history });

  const raw = await callModel({
    system,
    user,
    // Four specific questions need room; the old 120-token cap truncated the
    // fourth one and the JSON array with it.
    maxTokens: 260,
    // High enough to vary the angles, low enough to stay on topic.
    temperature: 0.8,
  });

  const suggestions = cleanSuggestions(parseSuggestions(raw));
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
  GENERIC_PATTERNS,
};
