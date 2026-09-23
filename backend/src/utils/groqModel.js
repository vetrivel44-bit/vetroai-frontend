const logger = require("./logger");

// Groq retires models regularly, and a retired name fails every request with
// model_not_found. When that happens, ask the account which models it can use
// and switch to the best one, instead of failing until someone edits GROQ_MODEL.
//
// The free tier also caps each model's tokens/requests *per day*, separately
// per model. When the configured model has used up its day, the others still
// have theirs — so switch to one of them until the cap resets, rather than
// giving up on Groq and letting another provider answer.
const PREFERRED_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "moonshotai/kimi-k2-instruct",
  "qwen/qwen3-32b",
  "openai/gpt-oss-20b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.1-8b-instant",
];
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

async function pickAvailableModel(client, rejected) {
  const skip = new Set([].concat(rejected));
  const ids = (await listChatModels(client)).filter((id) => !skip.has(id) && !isExhausted(id));
  return PREFERRED_MODELS.find((id) => ids.includes(id)) || ids[0] || null;
}

// Runs `call(model)`. If Groq says the model doesn't exist, retries once with
// an available model and keeps using it for the rest of the process. If the
// model has hit its daily cap, moves on to another model until the cap resets.
async function withGroqModel(client, model, call) {
  let current = replacements.get(model) || model;
  const tried = [];

  if (isExhausted(current)) {
    const next = await pickAvailableModel(client, current).catch(() => null);
    if (next) current = next;
  }

  for (;;) {
    tried.push(current);
    try {
      return await call(current);
    } catch (err) {
      if (isModelNotFound(err) && tried.length === 1) {
        const next = await pickAvailableModel(client, current).catch(() => null);
        if (!next) throw err;
        logger.warn("groq.modelReplaced", { from: current, to: next });
        replacements.set(model, next);
        current = next;
        continue;
      }
      const resetMs = dailyLimitResetMs(err);
      if (resetMs == null) throw err;
      exhaustedUntil.set(current, Date.now() + resetMs);
      if (tried.length > MAX_DAILY_SWITCHES) throw err;
      const next = await pickAvailableModel(client, tried).catch(() => null);
      if (!next) throw err;
      logger.warn("groq.dailyLimitSwitch", { from: current, to: next, resetsInMin: Math.round(resetMs / 60000) });
      current = next;
    }
  }
}

module.exports = { withGroqModel, isModelNotFound, dailyLimitResetMs, PREFERRED_MODELS, _exhaustedUntil: exhaustedUntil };
