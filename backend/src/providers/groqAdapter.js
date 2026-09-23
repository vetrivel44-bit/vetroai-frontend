const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");
const { withGroqModel } = require("../utils/groqModel");

const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;

// Groq counts the prompt *plus* the requested max_tokens against the model's
// tokens-per-minute limit (12k for llama-3.3-70b on the free tier), and turns
// down any single request above it with 413 "Request too large" before writing
// a word. VetroAI's system prompt alone is ~3k tokens, so a Deep/Max turn
// (8k max_tokens) or a chat with a few long answers failed every time. Each
// request is therefore fitted to this budget: shrink max_tokens first, then
// drop the oldest history, always keeping the system prompt and latest message.
const REQUEST_TOKEN_BUDGET = Number(process.env.GROQ_REQUEST_TOKEN_BUDGET) || 11000;
const MIN_REPLY_TOKENS = 1024;
const MAX_REPLY_TOKENS = 8192;

// Rough count (~3.5 chars per token, plus per-message overhead) — errs high
// so the fitted request stays under Groq's own count.
function estimateTokens(messages) {
  return messages.reduce((n, m) => n + Math.ceil(String(m.content || "").length / 3.5) + 4, 0);
}

function fitRequest(messages, maxTokens, budget = REQUEST_TOKEN_BUDGET) {
  let fitted = messages.slice();
  let reply = Math.min(maxTokens ?? 1024, MAX_REPLY_TOKENS);
  let prompt = estimateTokens(fitted);
  if (prompt + reply > budget) reply = Math.max(MIN_REPLY_TOKENS, budget - prompt);
  // Drop the oldest non-system messages until it fits (keep the latest one).
  while (prompt + reply > budget) {
    const i = fitted.findIndex((m, idx) => m.role !== "system" && idx < fitted.length - 1);
    if (i === -1) break;
    fitted.splice(i, 1);
    // A history must not start with an assistant turn.
    while (fitted[i] && fitted[i].role === "assistant" && i < fitted.length - 1) fitted.splice(i, 1);
    prompt = estimateTokens(fitted);
  }
  return { messages: fitted, maxTokens: reply };
}

const isTooLarge = (err) => err?.status === 413 || /request too large|request_too_large|context_length_exceeded|reduce (the length|your message)/i.test(err?.message || "");

async function generateStream(messages, options = {}) {
  if (!groq) {
    throw new ApiError(500, "Groq API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const create = (budget) => {
    const req = fitRequest(messages, maxTokens, budget);
    return withGroqModel(groq, model || config.groqModel || "llama-3.3-70b-versatile", (modelName) =>
      groq.chat.completions.create({
        model: modelName,
        messages: req.messages,
        temperature: temperature ?? 0.7,
        max_tokens: req.maxTokens,
        stream: true,
      }));
  };

  try {
    try {
      return await create(REQUEST_TOKEN_BUDGET);
    } catch (err) {
      if (!isTooLarge(err)) throw err;
      // Our estimate was low for this text (code, non-Latin scripts) — retry
      // once with a much smaller request rather than failing the turn.
      logger.warn("groqAdapter.requestTooLarge", { error: err.message });
      return await create(Math.floor(REQUEST_TOKEN_BUDGET * 0.6));
    }
  } catch (err) {
    logger.error("groqAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
  fitRequest,
  estimateTokens,
};
