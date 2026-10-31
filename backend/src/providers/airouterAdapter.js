const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// AI Router serves three models for VetroAI, picked by name in the model picker:
// DeepSeek V4.1 Flash (the default), Mercury 2.5, and Qwen 3.7 Flash (shown as
// "VetroAI"). AIROUTER_MODEL, AIROUTER_MERCURY_MODEL and AIROUTER_QWEN_MODEL
// override the ids only if AI Router names them differently.
const MODEL = "deepseek/deepseek-v4.1-flash";
const MERCURY_MODEL = "inception/mercury-2.5";
const QWEN_MODEL = "qwen/qwen3.7-flash";

// AI Router (airouter.in) exposes an OpenAI-compatible /chat/completions endpoint,
// so the stream is handed back untouched and parsed by AIOrchestrator.pipeStream
// (which also routes any `delta.reasoning_content` into the thinking panel).
function endpoint() {
  const base = (config.airouterBaseUrl || "https://api.airouter.in/v1").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function defaultModel() {
  return config.airouterModel || MODEL;
}

/**
 * "Mercury 2.5" → Mercury, "VetroAI" / "Qwen…" → Qwen 3.7 Flash,
 * "DeepSeek V4.1 Flash" / "AI Router" → DeepSeek, else null.
 */
function modelFor(label) {
  const text = String(label || "").trim();
  if (/mercury/i.test(text)) return config.airouterMercuryModel || MERCURY_MODEL;
  if (/qwen|^vetro\s?ai$/i.test(text)) return config.airouterQwenModel || QWEN_MODEL;
  if (/deepseek|ai[\s_-]?router/i.test(text)) return defaultModel();
  return null;
}

// A short-lived 429 is retried after a pause (Retry-After when sent, capped)
// rather than failing over on the first one. A spend or credit limit won't
// clear in seconds and is left to the orchestrator's fallback.
let rateLimitDelaysMs = [1500, 3000];
const MAX_RETRY_AFTER_MS = 6000;

function isTransientRateLimit(status, detail) {
  return status === 429 && !/per day|daily|quota|plan|billing|credit|spend/i.test(detail);
}

function retryDelay(res, fallbackMs) {
  const seconds = Number(res.headers?.get?.("retry-after"));
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

// Last 4 characters and length only, so the logs can confirm which key is
// loaded without exposing it.
function keyFingerprint() {
  const key = String(config.airouterApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  return key ? `…${key.slice(-4)} (${key.length} chars)` : "";
}

// Tolerates the usual paste mistakes in the env var: whitespace, quotes, "Bearer ".
function apiKey() {
  const key = String(config.airouterApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!key) {
    throw new ApiError(500, "AI Router API key not configured.");
  }
  return key;
}

// Sends one request, retrying a short-lived rate limit. Returns the ok Response.
async function send(body, { stream, timeoutMs, model = defaultModel() }) {
  const key = apiKey();
  const request = () => fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      // Some routers read the key from x-api-key instead of Authorization.
      "x-api-key": key,
      "Content-Type": "application/json",
      ...(stream ? { Accept: "text/event-stream" } : {}),
    },
    body: JSON.stringify({ ...body, model, stream }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let res = await request();
  let detail = res.ok ? "" : await res.text();
  for (const fallbackMs of rateLimitDelaysMs) {
    if (res.ok || !isTransientRateLimit(res.status, detail)) break;
    const waitMs = retryDelay(res, fallbackMs);
    logger.warn("airouterAdapter.rateLimited", { model, retryInMs: waitMs });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    res = await request();
    detail = res.ok ? "" : await res.text();
  }
  if (!res.ok) {
    if (res.status === 401) logger.warn("airouterAdapter.keyRejected", { key: keyFingerprint(), url: endpoint() });
    throw new ApiError(res.status, `AI Router service error: ${res.status} ${detail.slice(0, 300)}`);
  }
  return res;
}

async function generateStream(messages, options = {}) {
  // airouterModel is set only when this provider was picked by name; a
  // fallback from another provider gets the default model.
  const { temperature, maxTokens, airouterModel } = options;
  try {
    const res = await send({
      messages,
      temperature: temperature ?? config.airouterTemperature ?? 0.7,
      max_tokens: maxTokens ?? config.airouterMaxTokens ?? 8192,
    }, { stream: true, timeoutMs: 30000, model: airouterModel || defaultModel() });
    return res.body;
  } catch (err) {
    logger.error("airouterAdapter.generateStream", { error: err.message });
    throw err;
  }
}

// Non-streaming completion for short side tasks (chat titles, follow-ups,
// research planning).
async function complete(messages, { temperature = 0.4, maxTokens = 120 } = {}) {
  const res = await send({ messages, temperature, max_tokens: maxTokens }, { stream: false, timeoutMs: 15000 });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

module.exports = {
  generateStream,
  complete,
  MODEL,
  MERCURY_MODEL,
  QWEN_MODEL,
  modelFor,
  keyFingerprint,
  // Tests shorten the pauses between rate-limit retries.
  setRateLimitDelays: (delays) => { rateLimitDelaysMs = delays; },
};
