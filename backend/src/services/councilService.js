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
// The whole council, stand-ins included, so the reply never waits long.
const COUNCIL_TOTAL_MS = 32000;
// A stand-in is only asked with at least this much of that time left.
const STAND_IN_MIN_MS = 4000;
// Short answers: an opinion, not a finished reply.
const MEMBER_MAX_TOKENS = 700;
// How much of each answer the writer is shown.
const OPINION_CHARS = 1600;
const OPINION_CHARS_TIGHT = 900;
const COUNCIL_SIZE = 3;
// Who is asked, in order: the first three sit; when one can't answer (an
// error, a busy model, no answer in time) the next one in line takes its
// seat, so the council still hears three. Free or cheap and quick first.
// "airouter:<name>" is one of AI Router's models by its picker name (plain
// "airouter" is its default model), so AI Router's other models can stand
// in too. Claude Fable and ChatGPT (paid per request) are left out unless
// LLM_COUNCIL_MEMBERS names them.
const MEMBER_ORDER = ["groq", "gemini", "cohere", "airouter", "airouter:Ling 3.0 Flash", "airouter:VetroAI", "sarvam", "airouter:Grok 4.20"];

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

/** "airouter:Ling 3.0 Flash" → { provider: "airouter", variant: "Ling 3.0 Flash" }. */
function parseSeat(entry) {
  const [provider, ...rest] = String(entry || "").split(":");
  return { provider: provider.trim().toLowerCase(), variant: rest.join(":").trim() || "" };
}

/**
 * Everyone who may sit, in order: the first COUNCIL_SIZE sit, the rest stand
 * in for anyone who can't answer. From the order given (LLM_COUNCIL_MEMBERS,
 * else MEMBER_ORDER), only models whose provider is available, and never the
 * model writing the reply (the chair: its provider, and for AI Router the
 * model, via `modelOf(seat)`).
 */
function pickSeats({ available = [], chair = "", chairModel = "", order = "", modelOf = () => "" } = {}) {
  const wanted = String(order || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const seen = new Set();
  return (wanted.length ? wanted : MEMBER_ORDER).map(parseSeat).filter((seat) => {
    if (!seat.provider || !available.includes(seat.provider)) return false;
    const model = modelOf(seat) || "";
    const key = `${seat.provider}:${model || seat.variant}`;
    if (seen.has(key)) return false;
    seen.add(key);
    // The chair writes the reply; it doesn't also sit. A provider with one
    // model is the chair whatever the variant; AI Router only for its model.
    if (seat.provider === chair && (!chairModel || !model || model === chairModel)) return false;
    return true;
  });
}

/** The first COUNCIL_SIZE provider names (the members asked first). */
function pickMembers(options = {}) {
  return pickSeats(options).slice(0, COUNCIL_SIZE).map((seat) => seat.provider);
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
 * Asks the first `size` seats at once; when one can't answer, the next seat
 * in line takes its place (while there's time), so the council still hears
 * `size` answers. `seats`: from pickSeats (or plain provider names).
 * `ask(seat, messages)` resolves to that model's answer.
 * `onUpdate(snapshot)` hears the council as it sits: { phase: "asking" |
 * "done", members: [{ name, status: "asking" | "answered" | "failed",
 * answer, ms, standsInFor }], ms }. Resolves to the final snapshot.
 */
async function runCouncil({ seats, members, size = COUNCIL_SIZE, ask, labelFor = (seat) => seat.provider, messages, onUpdate, signal, timeoutMs = MEMBER_TIMEOUT_MS, totalMs = COUNCIL_TOTAL_MS } = {}) {
  const started = Date.now();
  const line = (seats || members || []).map((seat) => (typeof seat === "string" ? { provider: seat, variant: "" } : seat));
  const bench = line.slice(size);
  const table = [];
  const snapshot = (phase) => ({
    phase,
    members: table.map(({ name, status, answer, ms, standsInFor }) => ({ name, status, answer, ms, ...(standsInFor ? { standsInFor } : {}) })),
    ms: Date.now() - started,
  });
  const tell = (phase) => { if (!signal?.aborted) onUpdate?.(snapshot(phase)); };
  const sit = (seat, standsInFor = null) => {
    const entry = { seat, name: labelFor(seat), status: "asking", answer: "", ms: null, standsInFor };
    table.push(entry);
    return entry;
  };
  const hear = async (entry) => {
    const t0 = Date.now();
    const timeLeft = totalMs - (t0 - started);
    try {
      const answer = tidy(await withTimeout(Promise.resolve().then(() => ask(entry.seat, messages)), Math.max(1000, Math.min(timeoutMs, timeLeft))));
      if (!answer) throw new Error("no answer");
      entry.answer = answer.slice(0, OPINION_CHARS);
      entry.status = "answered";
    } catch {
      entry.status = "failed";
    }
    entry.ms = Date.now() - t0;
    // Couldn't answer: the next one in line takes the seat.
    const stillTime = totalMs - (Date.now() - started) >= STAND_IN_MIN_MS;
    if (entry.status === "failed" && bench.length && stillTime && !signal?.aborted) {
      const standIn = sit(bench.shift(), entry.name);
      tell("asking");
      await hear(standIn);
      return;
    }
    tell("asking");
  };
  const first = line.slice(0, size).map((seat) => sit(seat));
  tell("asking");
  await Promise.all(first.map(hear));
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
  pickSeats,
  pickMembers,
  memberMessages,
  runCouncil,
  chairBrief,
  MEMBER_MAX_TOKENS,
  MEMBER_ORDER,
  COUNCIL_SIZE,
};
