const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// AI Router serves exactly one model for VetroAI: DeepSeek V4.1 Flash.
// The id can be overridden with AIROUTER_MODEL only if AI Router renames it.
const MODEL = "deepseek/deepseek-v4.1-flash";

// AI Router (ai-router.dev) exposes an OpenAI-compatible /chat/completions endpoint,
// so the stream is handed back untouched and parsed by AIOrchestrator.pipeStream
// (which also routes any `delta.reasoning_content` into the thinking panel).
function endpoint() {
  const base = (config.airouterBaseUrl || "https://api.ai-router.dev/v1").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function model() {
  return config.airouterModel || MODEL;
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

// Tolerates the usual paste mistakes in the env var: whitespace, quotes, "Bearer ".
function apiKey() {
  const key = String(config.airouterApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!key) {
    throw new ApiError(500, "AI Router API key not configured.");
  }
  return key;
}

// Sends one request, retrying a short-lived rate limit. Returns the ok Response.
async function send(body, { stream, timeoutMs }) {
  const key = apiKey();
  const request = () => fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(stream ? { Accept: "text/event-stream" } : {}),
    },
    body: JSON.stringify({ ...body, model: model(), stream }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let res = await request();
  let detail = res.ok ? "" : await res.text();
  for (const fallbackMs of rateLimitDelaysMs) {
    if (res.ok || !isTransientRateLimit(res.status, detail)) break;
    const waitMs = retryDelay(res, fallbackMs);
    logger.warn("airouterAdapter.rateLimited", { model: model(), retryInMs: waitMs });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    res = await request();
    detail = res.ok ? "" : await res.text();
  }
  if (!res.ok) {
    throw new ApiError(res.status, `AI Router service error: ${res.status} ${detail.slice(0, 300)}`);
  }
  return res;
}

async function generateStream(messages, options = {}) {
  const { temperature, maxTokens } = options;
  try {
    const res = await send({
      messages,
      temperature: temperature ?? config.airouterTemperature ?? 0.7,
      max_tokens: maxTokens ?? config.airouterMaxTokens ?? 8192,
    }, { stream: true, timeoutMs: 30000 });
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
  // Tests shorten the pauses between rate-limit retries.
  setRateLimitDelays: (delays) => { rateLimitDelaysMs = delays; },
};
