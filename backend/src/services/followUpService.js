// Follow-up question generation helpers.
//
// The old implementation asked an 8B model for "4 concise follow-up questions"
// with no other guidance, which reliably produced the same four templates with
// the chat topic slotted in ("Can you explain X", "What is the best next step
// for X", "Can you give me a practical example", "What should I watch out
// for?"). These helpers replace that with a grounded prompt plus a validator
// that rejects template-shaped output, so a question only ships if it actually
// refers to something the answer said.

const STOPWORDS = new Set([
  "about", "after", "again", "against", "already", "also", "another", "answer",
  "because", "been", "before", "being", "below", "best", "better", "between",
  "both", "could", "does", "doing", "done", "down", "during", "each", "either",
  "else", "even", "every", "example", "examples", "explain", "first", "from",
  "further", "give", "good", "great", "have", "having", "here", "here's", "how",
  "into", "its", "itself", "just", "know", "like", "make", "many", "more",
  "most", "much", "must", "need", "next", "only", "other", "others", "our",
  "out", "over", "own", "same", "should", "since", "some", "step", "steps",
  "such", "than", "that", "their", "them", "then", "there", "these", "they",
  "thing", "things", "this", "those", "through", "thing", "time", "tell",
  "under", "until", "very", "want", "watch", "well", "were", "what", "when",
  "where", "which", "while", "who", "whom", "why", "will", "with", "within",
  "without", "would", "your", "yours",
]);

// Openings and whole questions that carry no information about the answer.
const GENERIC_PATTERNS = [
  /^(can|could|would|will) (you|u) (please )?(explain|describe|elaborate|clarify|expand|give|show|provide|tell|walk|help|summari[sz]e)\b/i,
  /^(please )?(explain|describe|clarify|summari[sz]e|elaborate on) (this|that|it|the (topic|above|answer))\b/i,
  /^(tell|teach) me more\b/i,
  /^(what|which) (is|are|would be) the (best )?next step/i,
  /^what should i (watch out for|be aware of|know|consider|avoid|do next)\b/i,
  /^(can you )?give me (a|an|some|more)? ?(practical|simple|real[- ]world|concrete)? ?examples?\b/i,
  /^(are there|is there) (any )?(other|more) (examples?|options?|things?)\b/i,
  /^(anything|something) else\b/i,
  /^how (does|do|did) (it|this|that|they|these) work\b/i,
  /^(what|how) about (it|this|that|them)\b/i,
  /^why (is|does|was) (it|this|that) (important|useful|matter|relevant)\b/i,
  /^(what|how) (is|are) (it|this|that|they) used for\b/i,
  /^(more|further) (details|information|info)\b/i,
  /^(what|which) (are|is) the (pros and cons|advantages and disadvantages|benefits)\??$/i,
];

// Placeholder text a model leaves behind when it fills a template badly.
const PLACEHOLDER_PATTERNS = [
  /\{[^}]*\}/,
  /\[[^\]]*\]/,
  /\b(the|this|that) (topic|subject|above|previous answer)\b/i,
  /\bx\b(?!\s*[-.]?\s*(ray|axis))/i,
  /\byour (topic|subject)\b/i,
];

const MIN_LENGTH = 12;
const MAX_LENGTH = 110;

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Content words: long enough to carry meaning and not on the stoplist.
function contentTokens(text) {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

// Users misspell and re-space the thing they are asking about ("lit mapps" vs
// "Litmaps"), so echo/grounding checks compare on a squeezed form: no spaces,
// no repeated letters.
function squeeze(text) {
  return normalize(text).replace(/(.)\1+/g, "$1").replace(/\s+/g, "");
}

function tokenSeenIn(token, haystackTokens, haystackSqueezed) {
  if (haystackTokens.includes(token)) return true;
  const squeezed = squeeze(token);
  return squeezed.length >= 4 && haystackSqueezed.includes(squeezed);
}

function stripDecorations(line) {
  return String(line || "")
    .replace(/^\s*[-*•–]\s*/, "")           // bullet markers
    .replace(/^\s*\d+[.)]\s*/, "")          // "1." / "1)"
    .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, "") // wrapping quotes
    .replace(/^\s*(follow[- ]?up|question|q)\s*\d*\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Accepts a JSON array, a fenced JSON block, or a plain newline list.
function parseSuggestions(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const arrayMatch = fenced.match(/\[[\s\S]*\]/);

  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" ? item : item?.question))
          .filter((item) => typeof item === "string")
          .map(stripDecorations)
          .filter(Boolean);
      }
    } catch { /* fall through to line parsing */ }
  }

  return fenced
    .split(/\r?\n/)
    .map(stripDecorations)
    .filter(Boolean);
}

function isGeneric(question) {
  return GENERIC_PATTERNS.some((pattern) => pattern.test(question));
}

function hasPlaceholder(question) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(question));
}

// True when the suggestion is the user's own question wearing a hat.
function echoesQuery(question, userQuery) {
  const queryTokens = contentTokens(userQuery);
  if (queryTokens.length === 0) return false;

  const questionTokens = contentTokens(question);
  if (questionTokens.length === 0) return true;

  const querySqueezed = squeeze(userQuery);
  const novel = questionTokens.filter(
    (token) => !tokenSeenIn(token, queryTokens, querySqueezed)
  );
  // Nothing new beyond the words the user already typed.
  return novel.length === 0;
}

// A real follow-up points at something the answer actually said.
function isGrounded(question, answer) {
  const answerTokens = contentTokens(answer);
  if (answerTokens.length === 0) return true; // nothing to check against
  const answerSqueezed = squeeze(answer);
  return contentTokens(question).some(
    (token) => tokenSeenIn(token, answerTokens, answerSqueezed)
  );
}

function ensureQuestionMark(question) {
  return /[?？]\s*$/.test(question) ? question : `${question}?`;
}

/**
 * Filters raw model output down to suggestions worth showing.
 * Returns at most `limit` questions; returns [] rather than templates.
 */
function refineSuggestions(rawSuggestions, { userQuery = "", answer = "", limit = 4 } = {}) {
  const seen = new Set();
  const kept = [];

  for (const candidate of rawSuggestions || []) {
    if (typeof candidate !== "string") continue;

    const question = stripDecorations(candidate);
    if (question.length < MIN_LENGTH || question.length > MAX_LENGTH) continue;
    if (isGeneric(question)) continue;
    if (hasPlaceholder(question)) continue;
    if (echoesQuery(question, userQuery)) continue;
    if (!isGrounded(question, answer)) continue;

    const key = normalize(question);
    if (!key || seen.has(key)) continue;

    // Reject near-duplicates of something already kept (same content words).
    const tokens = contentTokens(question);
    const duplicate = kept.some((existing) => {
      const existingTokens = contentTokens(existing);
      const shared = tokens.filter((token) => existingTokens.includes(token));
      const smaller = Math.min(tokens.length, existingTokens.length) || 1;
      return shared.length / smaller >= 0.8;
    });
    if (duplicate) continue;

    seen.add(key);
    kept.push(ensureQuestionMark(question));
    if (kept.length >= limit) break;
  }

  return kept;
}

const SYSTEM_PROMPT = [
  "You write follow-up questions for a chat assistant, in the style of Perplexity's related questions.",
  "",
  "Return ONLY a JSON array of 4 strings. No markdown, no object keys, no commentary.",
  "",
  "Every question must:",
  "- be grounded in a SPECIFIC detail from the assistant's answer: a named tool, feature, number, tradeoff, limitation or claim it actually mentioned",
  "- explore a DIFFERENT angle from the others (a comparison, a cost or limit, a concrete next action, an edge case, how it works underneath)",
  "- read like something a curious user would type: 4 to 12 words, plain language, ending in a question mark",
  "- be written in the same language as the assistant's answer",
  "",
  "Never do any of the following:",
  "- reuse a template such as \"Can you explain <topic>\", \"Tell me more about <topic>\", \"Can you give me a practical example\", \"What is the best next step for <topic>\", or \"What should I watch out for\"",
  "- restate or lightly reword the user's original question",
  "- ask something the answer already fully answered",
  "- refer to \"this topic\", \"the above\" or any other placeholder instead of naming the thing",
].join("\n");

function buildFollowUpMessages({ userQuery = "", answer = "", rejected = [] } = {}) {
  const retryNote = rejected.length
    ? `\n\nThese were rejected as too generic — do not produce anything like them:\n${rejected.map((r) => `- ${r}`).join("\n")}`
    : "";

  return [
    { role: "system", content: SYSTEM_PROMPT + retryNote },
    {
      role: "user",
      content: `User asked:\n${String(userQuery || "(not provided)").slice(0, 400)}\n\nAssistant answered:\n${String(answer).slice(0, 2400)}`,
    },
  ];
}

module.exports = {
  buildFollowUpMessages,
  parseSuggestions,
  refineSuggestions,
  isGeneric,
  echoesQuery,
  isGrounded,
  contentTokens,
  squeeze,
  SYSTEM_PROMPT,
};
