"use strict";

// The council: for a question that needs real thought, a few other AI models
// answer it on their own first, and the model writing the reply weighs their
// answers before it writes: what they agree on, where they differ and which
// side has the better case, and any mistakes. One model can be confidently
// wrong; several whose answers have to be reconciled rarely are.
//
// It happens inside the thinking. The reply reads as one answer from the
// model that wrote it, and the council (who was asked, what each said) is
// shown only when the person opens the thinking panel (frontend
// ResponseProcess.jsx), sent as "council" events while it sits.
//
// When it sits (needsCouncil): never for small talk, drawings, pictures,
// attachments, screen control or DeepSearch (which has its own research).
// At the Max and Deep effort levels, for any real question; at the default,
// for questions that need judgement (comparing, deciding, planning,
// analysing, debugging, proving…) or long, many-part ones; at Quick, only
// for the clearest of those.

const MEMBER_TIMEOUT_MS = 20000;
// Short answers: an opinion, not a finished reply.
const MEMBER_MAX_TOKENS = 700;
// How much of each answer the writer is shown.
const OPINION_CHARS = 1600;
const OPINION_CHARS_TIGHT = 900;
const COUNCIL_SIZE = 3;
// Free or cheap and quick first. Claude Fable and ChatGPT (paid per request)
// are left out unless LLM_COUNCIL_MEMBERS names them.
const MEMBER_ORDER = ["groq", "gemini", "cohere", "airouter", "sarvam"];

const SKIP_MODES = new Set(["computer_use", "research", "deep_search", "multi_ai"]);

// Questions that need judgement, not a lookup.
const NEEDS_JUDGEMENT = /\b(?:compare|comparison|vs\.?|versus|difference between|pros and cons|trade-?offs?|should (?:i|we)|which (?:one|is better|should)|better|best (?:way|option|choice|approach|plan)|recommend|decide|decision|strategy|strategi[sz]e|plan(?:ning)?|roadmap|analy[sz]e|analysis|evaluate|assess|critique|review my|why (?:does|do|is|are|did|would)|prove|derive|optimi[sz]e|debug|root cause|architecture|design (?:a|an|the)|risks?|worth it|invest|forecast|predict|diagnos|negotiat|ethic)/i;
// The clearest of those, for the Quick effort level.
const CLEARLY_HARD = /\b(?:compare|versus|pros and cons|trade-?offs?|should (?:i|we)|which (?:one|is better)|decide|decision|strategy|analy[sz]e|evaluate|prove|derive|debug|root cause|architecture|worth it|invest)/i;

/**
 * Does this question deserve the council?
 * effort: "quick" | "balanced" | "deep" | "max" (the app's effort picker).
 */
function needsCouncil({ query = "", effort = "balanced", mode = "", isGreeting = false, light = false, drawing = false, needsVision = false, hasAttachments = false, enabled = true } = {}) {
  if (!enabled) return false;
  const q = String(query || "").trim();
  if (q.length < 25 || isGreeting || light || drawing || needsVision || hasAttachments) return false;
  if (SKIP_MODES.has(String(mode || ""))) return false;
  const level = String(effort || "balanced").toLowerCase();
  if (level === "max" || level === "deep") return true;
  if (level === "quick") return CLEARLY_HARD.test(q);
  const questions = (q.match(/\?/g) || []).length;
  return NEEDS_JUDGEMENT.test(q) || q.length >= 220 || questions >= 2;
}

/**
 * The members: up to COUNCIL_SIZE of the available providers, other than the
 * one writing the reply (the chair), in the order given (LLM_COUNCIL_MEMBERS,
 * else MEMBER_ORDER).
 */
function pickMembers({ available = [], chair = "", order = "" } = {}) {
  const wanted = String(order || "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  const list = wanted.length ? wanted : MEMBER_ORDER;
  return [...new Set(list)].filter((name) => name !== chair && available.includes(name)).slice(0, COUNCIL_SIZE);
}

const textOf = (message) => (typeof message?.content === "string" ? message.content : "");

/**
 * What each member is sent: a short brief, the live search results if there
 * are any, and the last few turns of the conversation ending with the
 * question.
 */
function memberMessages({ history = [], webContext = "", clockText = "" } = {}) {
  const system = [
    "You're one member of a council of AI models. Each member answers the user's latest message on their own; then another model compares every answer and writes the final reply.",
    "Give your honest best answer in under 220 words: the key facts and reasoning, a clear conclusion or recommendation, and anything you're unsure of or that is easy to get wrong. Plain sentences or a short list; no tables, code or headings unless the question needs them. Don't mention the council.",
    clockText,
    webContext ? `Live search results, fetched just now. Trust them over your memory:\n${String(webContext).slice(0, 5000)}` : "",
  ].filter(Boolean).join("\n\n");
  const turns = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && textOf(m).trim())
    .slice(-7)
    .map((m) => ({ role: m.role, content: textOf(m).slice(0, 1500) }));
  // A conversation starts with the person.
  while (turns.length && turns[0].role !== "user") turns.shift();
  return [{ role: "system", content: system }, ...turns];
}

// A member's answer as the writer and the panel see it: no reasoning tags,
// no stray whitespace.
const tidy = (text) => String(text || "")
  .replace(/<think>[\s\S]*?<\/think>/gi, "")
  .replace(/<\/?think>/gi, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("took too long")), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
});

/**
 * Asks every member at once. `ask(provider, messages)` resolves to that
 * model's answer. `onUpdate(snapshot)` hears the council as it sits:
 * { phase: "asking" | "done", members: [{ name, status: "asking" |
 * "answered" | "failed", answer, ms }], ms }. Resolves to the final snapshot.
 */
async function runCouncil({ members = [], ask, labelFor = (name) => name, messages, onUpdate, signal, timeoutMs = MEMBER_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const seats = members.map((provider) => ({ provider, name: labelFor(provider), status: "asking", answer: "", ms: null }));
  const snapshot = (phase) => ({
    phase,
    members: seats.map(({ name, status, answer, ms }) => ({ name, status, answer, ms })),
    ms: Date.now() - started,
  });
  const tell = (phase) => { if (!signal?.aborted) onUpdate?.(snapshot(phase)); };
  tell("asking");
  await Promise.all(seats.map(async (seat) => {
    const t0 = Date.now();
    try {
      const answer = tidy(await withTimeout(Promise.resolve().then(() => ask(seat.provider, messages)), timeoutMs));
      if (!answer) throw new Error("no answer");
      seat.answer = answer.slice(0, OPINION_CHARS);
      seat.status = "answered";
    } catch {
      seat.status = "failed";
    }
    seat.ms = Date.now() - t0;
    tell("asking");
  }));
  const result = snapshot("done");
  if (!signal?.aborted) onUpdate?.(result);
  return result;
}

/**
 * The notes added to the writer's system prompt: the members' answers and
 * how to use them. "" when nobody answered. `tight`: a writer with a small
 * request budget (Groq) is shown shorter answers.
 */
function chairBrief(result, { tight = false } = {}) {
  const heard = (result?.members || []).filter((m) => m.status === "answered" && m.answer);
  if (!heard.length) return "";
  const limit = tight ? OPINION_CHARS_TIGHT : OPINION_CHARS;
  const answers = heard.map((m, i) => `[Answer ${i + 1}, from ${m.name}]\n${m.answer.slice(0, limit)}`).join("\n\n");
  return `

# COUNCIL NOTES (internal: never mention them)
Before you reply, ${heard.length === 1 ? "another AI model" : `${heard.length} other AI models`} answered the user's latest message on ${heard.length === 1 ? "its" : "their"} own. ${heard.length === 1 ? "Its answer is" : "Their answers are"} below. Use ${heard.length === 1 ? "it" : "them"} to give the best reply you can: keep what they get right and agree on; where they disagree, think it through and go with the best-supported view; correct anything wrong; add anything important they missed. Then write your reply in your own voice, following every rule above. Don't mention the council, other models, or that you were shown other answers.

${answers}
# END OF COUNCIL NOTES`;
}

module.exports = {
  needsCouncil,
  pickMembers,
  memberMessages,
  runCouncil,
  chairBrief,
  MEMBER_MAX_TOKENS,
  MEMBER_ORDER,
};
