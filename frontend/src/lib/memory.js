// Remembered facts — the "Memory across chats" feature.
//
// A memory is one short statement the assistant should carry between
// conversations ("name is Vetrivel", "preparing for GATE 2027"). They are sent
// with every chat request and injected into the system prompt by the backend,
// which already expects a plain array of strings.

/** Longest single memory worth keeping; matches the Firestore rule's cap. */
export const MAX_MEMORY_LENGTH = 2000;

/** Beyond this the system prompt grows enough to cost real tokens per request. */
export const MAX_MEMORIES = 50;

/**
 * Phrases that mean "store this". Matched at the start of a message ("Remember
 * that my name is Vetrivel") or at the end ("My name is Vetrivel, remember
 * that.") so the instruction is recognized wherever people naturally put it —
 * a passing mention buried mid-sentence ("I can never remember which one")
 * still does not trigger a save.
 *
 * Deliberately explicit rather than model-inferred: the user sees exactly what
 * was saved and why, and a memory is never created by a sentence they did not
 * intend as an instruction.
 */
const LEADING_RE =
  /^\s*(?:please\s+)?(?:remember|memorize|note|keep in mind|don'?t forget|make a note)(?:\s+that)?[:,]?\s+(.+)$/is;
const TRAILING_RE =
  /^(.+?)[,.\s]+(?:so\s+)?(?:please\s+)?(?:remember|memorize|note|keep in mind|don'?t forget)(?:\s+(?:this|that))?[.!]?\s*$/is;

/**
 * Extract the fact from a "remember ..." message, or null if it is not one.
 *
 * The captured text is stored as the user wrote it, minus the instruction
 * phrase and trailing punctuation — "Remember that my name is Vetrivel." and
 * "My name is Vetrivel, remember that." both give "my name is Vetrivel".
 */
export function extractMemory(message) {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  const match = LEADING_RE.exec(trimmed) || TRAILING_RE.exec(trimmed);
  if (!match) return null;

  const text = match[1].trim().replace(/[.!,;\s]+$/, "");
  if (text.length < 2 || text.length > MAX_MEMORY_LENGTH) return null;
  // A multi-paragraph message is a conversation, not a fact.
  if (text.split(/\n\s*\n/).length > 1) return null;
  // "Remember this" points at something said earlier rather than carrying the
  // fact itself, so storing the pronoun would save a memory that means nothing
  // once the conversation is gone.
  if (/^(this|that|it|these|those|them)$/i.test(text)) return null;

  return text;
}

/** Normalised form used for duplicate detection. */
const canonical = (text) => text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!,;]+$/, "");

/** True if `text` is already remembered, ignoring case, spacing and punctuation. */
export const isDuplicate = (memories, text) =>
  memories.some((m) => canonical(m.text || "") === canonical(text));

/** Build a new memory record. */
export const makeMemory = (text, source = "manual") => ({
  id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  text: text.trim().slice(0, MAX_MEMORY_LENGTH),
  source,
  createdAt: Date.now(),
});

/**
 * The shape the backend wants: a plain array of strings, newest last so the
 * model reads the most recent context closest to the question.
 */
export const toPromptList = (memories) =>
  [...memories]
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map((m) => m.text)
    .filter(Boolean);

// ─── Automatic memory capture ("remember like ChatGPT") ─────────────────────
//
// The explicit "remember that ..." path above only saves what the user
// deliberately flags. ChatGPT-style memory also picks up durable facts from
// ordinary conversation without being asked. Doing that well needs a model
// call — a regex can't tell "my birthday is in March" (worth keeping) from
// "March was a rough month" (not) — so this runs a small classification
// prompt against the message the user just sent and asks it to name 0-3
// facts, on the client via the same free Puter bridge the app already uses
// for chat, rather than adding a paid backend call to every message.

/**
 * Cheap, local pre-filter so most messages never reach the model at all —
 * short reactions, greetings and plain questions are essentially never
 * durable personal facts, and skipping them keeps the extra call rare rather
 * than firing on every single message.
 */
export function looksMemorable(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 12 || trimmed.length > 1500) return false;
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|sure|cool|nice|lol|great)[!.\s]*$/i.test(trimmed)) return false;
  // A message that is only a question is almost never a fact about the user
  // — "What's the capital of France?" carries nothing worth keeping.
  if (trimmed.endsWith("?") && !/\bmy\b|\bi'?m\b|\bi am\b|\bi have\b|\bi work\b|\bi live\b/i.test(trimmed)) return false;
  return true;
}

export const AUTO_MEMORY_SYSTEM_PROMPT = `You extract durable personal facts about the user from a single chat message, the way an assistant remembers things between separate conversations.

Return ONLY a JSON array of short strings — each one a specific, durable fact worth remembering long-term (name, role, ongoing project, preference, deadline, relationship, recurring context). Phrase each fact so it reads naturally stored as-is, e.g. "prefers concise answers", "is preparing for GATE 2027", "works as a backend developer".

Rules:
- Return [] if the message has no durable fact worth remembering — most messages have none. Questions, small talk, and one-off requests are NOT facts.
- Never invent or infer beyond what is stated.
- Never include passwords, API keys, tokens, or anything that looks like a credential.
- At most 3 facts per message.
- Output raw JSON only — no prose, no markdown fences.`;

/** Parse the model's response into a clean array of candidate memory strings. */
export function parseAutoMemoryResponse(raw) {
  if (typeof raw !== "string") return [];
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= MAX_MEMORY_LENGTH)
    .slice(0, 3);
}
