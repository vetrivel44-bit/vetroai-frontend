const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");
const { withGroqModel, quietReasoning, VISION_MODELS } = require("../utils/groqModel");

const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;

// Groq counts the prompt *plus* the requested max_tokens against the model's
// tokens-per-minute limit (12k for llama-3.3-70b on the free tier), and turns
// down any single request above it with 413 "Request too large" before writing
// a word. VetroAI's system prompt alone is ~3k tokens, so a Deep/Max turn
// (8k max_tokens) or a chat with a few long answers failed every time. Each
// request is therefore fitted to this budget: shrink max_tokens first, then
// drop the oldest history, always keeping the system prompt and latest message.
// Groq's current models (gpt-oss-120b, qwen3.8-27b) list 8k tokens a minute
// (console.groq.com/docs/rate-limits, Oct 2026), so a request is kept under
// that; GROQ_REQUEST_TOKEN_BUDGET raises it for an account with more.
const REQUEST_TOKEN_BUDGET = Number(process.env.GROQ_REQUEST_TOKEN_BUDGET) || 7800;
const MIN_REPLY_TOKENS = 1024;
const MAX_REPLY_TOKENS = 8192;

// Groq counts each image as 2,048 input tokens and takes at most 3 a request
// (console.groq.com/docs/vision).
const IMAGE_TOKENS = 2048;
const MAX_IMAGES = 3;

// Rough count (~3.5 chars per token, plus per-message overhead) — errs high
// so the fitted request stays under Groq's own count.
function estimateTokens(messages) {
  return messages.reduce((n, m) => n
    + Math.ceil(String(m.content || "").length / 3.5) + 4
    + (Array.isArray(m.images) ? m.images.length * IMAGE_TOKENS : 0), 0);
}

const imagesOf = (m) => (Array.isArray(m?.images) ? m.images.filter((img) => img?.data && img?.mimeType) : []);

// Only the newest MAX_IMAGES images are kept (the latest are what the
// question is about); older ones are dropped from their messages.
function keepNewestImages(messages) {
  let room = MAX_IMAGES;
  return messages.slice().reverse().map((m) => {
    const images = imagesOf(m);
    if (!images.length) return m;
    const kept = images.slice(-room);
    room -= kept.length;
    return { ...m, images: kept };
  }).reverse();
}

// The OpenAI-style content array Groq's vision models read.
function toContent(message) {
  const images = imagesOf(message);
  if (!images.length) return message.content;
  const parts = [];
  if (message.content) parts.push({ type: "text", text: message.content });
  for (const img of images) parts.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
  return parts;
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

  const { temperature, maxTokens, model, light } = options;
  // A turn carrying images goes to Groq's vision model, and is never moved
  // to a text-only one if that model is gone (the orchestrator then tries
  // the next vision provider).
  const vision = messages.some((m) => imagesOf(m).length);
  const source = vision ? keepNewestImages(messages) : messages;
  const chosen = vision ? config.groqVisionModel : (model || config.groqModel);
  const create = (budget) => {
    const req = fitRequest(source, maxTokens, budget);
    return withGroqModel(groq, chosen, (modelName) =>
      groq.chat.completions.create({
        model: modelName,
        // Rebuilt, so the custom `images` key never reaches Groq.
        messages: req.messages.map((m) => ({ role: m.role, content: toContent(m) })),
        temperature: temperature ?? 0.7,
        max_tokens: req.maxTokens,
        stream: true,
        // A quick job (a course chapter, a greeting): no long reasoning pass.
        ...(light || vision ? quietReasoning(modelName) : {}),
      }), vision ? { candidates: VISION_MODELS.includes(chosen) ? VISION_MODELS : [chosen, ...VISION_MODELS] } : undefined);
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
  // Live search results go with the question, not inside the system prompt:
  // there Groq answered from its own out-of-date training, as Sarvam did.
  searchResultsWithQuestion: () => true,
  fitRequest,
  estimateTokens,
};
