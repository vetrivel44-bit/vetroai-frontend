const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// AI Router serves three models for VetroAI, picked by name in the model picker:
// DeepSeek V4.1 Flash (the default), Ling 3.0 Flash, and Qwen 3.7 Flash (shown as
// "VetroAI"). AIROUTER_MODEL, AIROUTER_LING_MODEL and AIROUTER_QWEN_MODEL
// override the ids only if AI Router names them differently.
const MODEL = "deepseek/deepseek-v4.1-flash";
const LING_MODEL = "inclusionai/ling-3.0-flash";
const QWEN_MODEL = "alibaba/qwen3.7-flash";

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
 * "Ling 3.0 Flash" → Ling, "VetroAI" / "Qwen…" → Qwen 3.7 Flash,
 * "DeepSeek V4.1 Flash" / "AI Router" → DeepSeek, else null.
 */
function modelFor(label) {
  const text = String(label || "").trim();
  if (/\bling\b/i.test(text)) return config.airouterLingModel || LING_MODEL;
  if (/qwen|^vetro\s?ai$/i.test(text)) return config.airouterQwenModel || QWEN_MODEL;
  if (/deepseek|ai[\s_-]?router/i.test(text)) return defaultModel();
  return null;
}

/** The picker name of an AI Router model id, for labelling the reply. */
function displayName(modelId) {
  const id = String(modelId || defaultModel());
  if (/(^|\/)ling-/i.test(id)) return "Ling 3.0 Flash";
  if (/qwen/i.test(id)) return "VetroAI";
  return "DeepSeek V4.1 Flash";
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

function isUnknownModelError(status, detail) {
  return [400, 404, 422].includes(status) && /model/i.test(detail);
}

// The model ids above are VetroAI's best guess at AI Router's names. When AI
// Router rejects one, its model list (/v1/models) is fetched once and the
// closest match is used from then on, so a differently named id ("ling-3.0-flash",
// "qwen3.7-flash", "inclusionai/ling-3-0-flash"…) still works without a config change.
const resolvedModels = new Map();
let modelListCache = null;

const squash = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const lastSegment = (id) => String(id || "").split("/").pop();

/** The id in `available` that names the same model as `wanted`, or null. */
function matchModel(wanted, available) {
  const target = squash(lastSegment(wanted));
  if (!target) return null;
  const ids = available.filter(Boolean);
  const exact = ids.find((id) => squash(lastSegment(id)) === target);
  if (exact) return exact;
  const containing = ids.filter((id) => squash(id).includes(target));
  if (containing.length) return containing.sort((a, b) => a.length - b.length)[0];
  // Every word and version number of the wanted name, in any form.
  const tokens = lastSegment(wanted).toLowerCase().split(/[^a-z0-9]+|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/).filter(Boolean);
  const all = ids.filter((id) => {
    const s = squash(id);
    return tokens.every((t) => s.includes(t));
  });
  return all.length ? all.sort((a, b) => a.length - b.length)[0] : null;
}

async function listModels(key) {
  if (modelListCache) return modelListCache;
  const res = await fetch(endpoint().replace(/\/chat\/completions$/, "/models"), {
    headers: { Authorization: `Bearer ${key}`, "x-api-key": key },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`model list ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.data || data.models || [];
  modelListCache = list.map((m) => (typeof m === "string" ? m : m?.id || m?.name)).filter(Boolean);
  return modelListCache;
}

async function resolveRejectedModel(key, model) {
  try {
    const available = await listModels(key);
    const match = matchModel(model, available);
    logger.warn("airouterAdapter.modelRejected", {
      model,
      useInstead: match || "(no match)",
      available: available.join(", "),
    });
    return match && match !== model ? match : null;
  } catch (err) {
    logger.warn("airouterAdapter.modelListFailed", { model, error: err.message });
    return null;
  }
}

// Sends one request, retrying a short-lived rate limit. Returns the ok Response.
// For a stream, timeoutMs bounds only the wait for the reply to start: a long
// answer may keep streaming past it (the orchestrator's idle watchdog guards a
// stalled stream). It used to abort the whole reply at 30s.
// No reasoning_effort is sent: with it, airouter.in held DeepSeek and Qwen
// requests for over 30s without answering (without it they answer in seconds).
async function send(body, { stream, timeoutMs, model: wantedModel = defaultModel() } = {}) {
  const key = apiKey();
  let model = resolvedModels.get(wantedModel) || wantedModel;
  const request = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`AI Router did not respond within ${timeoutMs / 1000}s`)), timeoutMs);
    try {
      return await fetch(endpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          // Some routers read the key from x-api-key instead of Authorization.
          "x-api-key": key,
          "Content-Type": "application/json",
          ...(stream ? { Accept: "text/event-stream" } : {}),
        },
        body: JSON.stringify({ ...body, model, stream }),
        signal: controller.signal,
      });
    } finally {
      if (stream) clearTimeout(timer);
      else timer.unref?.();
    }
  };

  logger.info("airouterAdapter.request", { model, stream });
  let res = await request();
  let detail = res.ok ? "" : await res.text();
  if (!res.ok && isUnknownModelError(res.status, detail)) {
    const match = await resolveRejectedModel(key, model);
    if (match) {
      model = match;
      res = await request();
      detail = res.ok ? "" : await res.text();
      if (res.ok) resolvedModels.set(wantedModel, match);
    }
  }
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
    const startedAt = Date.now();
    const model = airouterModel || defaultModel();
    const res = await send({
      messages,
      temperature: temperature ?? config.airouterTemperature ?? 0.7,
      max_tokens: maxTokens ?? config.airouterMaxTokens ?? 8192,
    }, { stream: true, timeoutMs: 30000, model });
    return timed(res.body, model, startedAt, Date.now() - startedAt);
  } catch (err) {
    logger.error("airouterAdapter.generateStream", { error: err.message });
    throw err;
  }
}

// Logs where a reply's time goes: until AI Router answered, until the first
// streamed bytes, and until the end — so a slow reply shows whether the wait
// was before the model started or while it wrote.
function timed(body, model, startedAt, headersMs) {
  if (!body?.pipeThrough) return body;
  let firstChunkMs = null;
  let bytes = 0;
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      if (firstChunkMs === null) firstChunkMs = Date.now() - startedAt;
      bytes += chunk?.byteLength || 0;
      controller.enqueue(chunk);
    },
    flush() {
      logger.info("airouterAdapter.timing", { model, headersMs, firstChunkMs, totalMs: Date.now() - startedAt, bytes });
    },
  }));
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
  LING_MODEL,
  QWEN_MODEL,
  modelFor,
  displayName,
  matchModel,
  keyFingerprint,
  resetResolvedModels: () => { resolvedModels.clear(); modelListCache = null; },
  // Tests shorten the pauses between rate-limit retries.
  setRateLimitDelays: (delays) => { rateLimitDelaysMs = delays; },
};
