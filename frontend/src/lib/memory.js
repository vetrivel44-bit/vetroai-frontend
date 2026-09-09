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
 * Phrases that mean "store this". Matched against the start of a message so a
 * passing mention ("I can never remember which one") does not trigger a save.
 *
 * Deliberately explicit rather than model-inferred: the user sees exactly what
 * was saved and why, and a memory is never created by a sentence they did not
 * intend as an instruction.
 */
const CAPTURE_RE =
  /^\s*(?:please\s+)?(?:remember|note|keep in mind|don'?t forget)(?:\s+that)?[:,]?\s+(.+)$/is;

/**
 * Extract the fact from a "remember ..." message, or null if it is not one.
 *
 * The captured text is stored as the user wrote it, minus the instruction
 * prefix and trailing punctuation — "Remember that my name is Vetrivel." gives
 * "my name is Vetrivel".
 */
export function extractMemory(message) {
  if (typeof message !== "string") return null;
  const match = CAPTURE_RE.exec(message.trim());
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
