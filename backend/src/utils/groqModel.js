const logger = require("./logger");

// Groq retires models regularly, and a retired name fails every request with
// model_not_found. When that happens, ask the account which models it can use
// and switch to the best one, instead of failing until someone edits GROQ_MODEL.
//
// The free tier also caps each model's tokens/requests *per day*, separately
// per model. When the configured model has used up its day, the others still
// have theirs — so switch to one of them until the cap resets, rather than
// giving up on Groq and letting another provider answer.
// Groq shut qwen3-32b and llama-4-scout down in July 2026 and announced
// llama-3.3-70b's for August (console.groq.com/docs/deprecations); the
// current replacements lead. An id the account doesn't have is just skipped.
const PREFERRED_MODELS = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "qwen/qwen3.8-27b",
  "moonshotai/kimi-k2-instruct",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];

// The Groq models that read images. qwen3.8-27b is a preview model, which
// Groq can withdraw at short notice; a vision request is then never moved to
// a text-only model (see `candidates` below) but fails over to another
// provider instead.
const VISION_MODELS = ["qwen/qwen3.8-27b"];

/**
 * How to keep a model from reasoning at length before a short or plain job
 * (a title, follow-up questions, a course chapter). Qwen 3 can switch it off;
 * gpt-oss can't, so it reasons briefly. Other models take no such field.
 */
function quietReasoning(model) {
  const id = String(model || "");
  if (/^qwen\//i.test(id)) return { reasoning_effort: "none" };
  if (/gpt-oss/i.test(id)) return { reasoning_effort: "low" };
  return {};
}
const NON_CHAT_MODEL = /whisper|tts|guard|embed|playai|orpheus|compound|prompt-guard/i;
const MAX_DAILY_SWITCHES = 3;

const replacements = new Map();
const exhaustedUntil = new Map(); // model -> timestamp its daily cap resets

function isModelNotFound(err) {
  const text = `${err?.message || ""} ${JSON.stringify(err?.error || "")}`;
  return err?.status === 404 || /model_not_found|does not exist|decommissioned/i.test(text);
}

// "Rate limit reached for model `x` ... on tokens per day (TPD) ... Please try
// again in 14m1.968s" — a daily cap, as opposed to the per-minute ones that
// clear in seconds.
function dailyLimitResetMs(err) {
  const text = `${err?.message || ""} ${JSON.stringify(err?.error || "")}`;
  if (!/per day|\bTPD\b|\bRPD\b/i.test(text)) return null;
  const m = /try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(text);
  const ms = m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 : 0;
  return ms > 0 ? ms : 60 * 60 * 1000;
}

const isExhausted = (model) => (exhaustedUntil.get(model) || 0) > Date.now();

async function listChatModels(client) {
  const list = await client.models.list();
  return (list?.data || [])
    .filter((m) => m && m.id && m.active !== false && !NON_CHAT_MODEL.test(m.id))
    .map((m) => m.id);
}

// `candidates`: only these may stand in (a vision request needs a model that
// can see); otherwise the preferred list, then anything the account has.
async function pickAvailableModel(client, rejected, candidates = null) {
  const skip = new Set([].concat(rejected));
  const ids = (await listChatModels(client)).filter((id) => !skip.has(id) && !isExhausted(id));
  if (candidates) return candidates.find((id) => ids.includes(id)) || null;
  return PREFERRED_MODELS.find((id) => ids.includes(id)) || ids[0] || null;
}

// Runs `call(model)`. If Groq says the model doesn't exist, retries once with
// an available model and keeps using it for the rest of the process. If the
// model has hit its daily cap, moves on to another model until the cap resets.
// `candidates` limits which models may replace it.
async function withGroqModel(client, model, call, { candidates = null } = {}) {
  const key = candidates ? `${model}|${candidates.join(",")}` : model;
  let current = replacements.get(key) || model;
  const tried = [];

  if (isExhausted(current)) {
    const next = await pickAvailableModel(client, current, candidates).catch(() => null);
    if (next) current = next;
  }

  for (;;) {
    tried.push(current);
    try {
      return await call(current);
    } catch (err) {
      if (isModelNotFound(err) && tried.length === 1) {
        const next = await pickAvailableModel(client, current, candidates).catch(() => null);
        if (!next) throw err;
        logger.warn("groq.modelReplaced", { from: current, to: next });
        replacements.set(key, next);
        current = next;
        continue;
      }
      const resetMs = dailyLimitResetMs(err);
      if (resetMs == null) throw err;
      exhaustedUntil.set(current, Date.now() + resetMs);
      if (tried.length > MAX_DAILY_SWITCHES) throw err;
      const next = await pickAvailableModel(client, tried, candidates).catch(() => null);
      if (!next) throw err;
      logger.warn("groq.dailyLimitSwitch", { from: current, to: next, resetsInMin: Math.round(resetMs / 60000) });
      current = next;
    }
  }
}

module.exports = { withGroqModel, isModelNotFound, dailyLimitResetMs, quietReasoning, PREFERRED_MODELS, VISION_MODELS, _exhaustedUntil: exhaustedUntil, _replacements: replacements };
