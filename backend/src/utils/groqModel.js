const logger = require("./logger");

// Groq retires models regularly, and a retired name fails every request with
// model_not_found. When that happens, ask the account which models it can use
// and switch to the best one, instead of failing until someone edits GROQ_MODEL.
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

const replacements = new Map();

function isModelNotFound(err) {
  const text = `${err?.message || ""} ${JSON.stringify(err?.error || "")}`;
  return err?.status === 404 || /model_not_found|does not exist|decommissioned/i.test(text);
}

async function pickAvailableModel(client, rejected) {
  const list = await client.models.list();
  const ids = (list?.data || [])
    .filter((m) => m && m.id && m.active !== false && !NON_CHAT_MODEL.test(m.id) && m.id !== rejected)
    .map((m) => m.id);
  return PREFERRED_MODELS.find((id) => id !== rejected && ids.includes(id)) || ids[0] || null;
}

// Runs `call(model)`; if Groq says the model doesn't exist, retries once with
// an available model and keeps using it for the rest of the process.
async function withGroqModel(client, model, call) {
  const current = replacements.get(model) || model;
  try {
    return await call(current);
  } catch (err) {
    if (!isModelNotFound(err)) throw err;
    const next = await pickAvailableModel(client, current).catch(() => null);
    if (!next) throw err;
    logger.warn("groq.modelReplaced", { from: current, to: next });
    replacements.set(model, next);
    return call(next);
  }
}

module.exports = { withGroqModel, isModelNotFound, PREFERRED_MODELS };
