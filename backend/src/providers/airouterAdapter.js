const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Used when nothing is configured, and as a one-time retry when AI Router
// rejects the configured model name. Model ids are "provider/model".
const DEFAULT_MODEL = "openai/gpt-oss-120b";

// AI Router (ai-router.dev) exposes an OpenAI-compatible /chat/completions endpoint,
// so the stream is handed back untouched and parsed by AIOrchestrator.pipeStream.
// Reasoning models emit `delta.reasoning` (or `delta.reasoning_content`)
// alongside `delta.content`; the orchestrator routes those into the thinking panel.
function endpoint() {
  const base = (config.airouterBaseUrl || "https://api.ai-router.dev/v1").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function isUnknownModelError(status, detail) {
  return [400, 404, 422].includes(status) && /model/i.test(detail);
}

// gpt-oss and the other reasoning models think before every answer, and with
// no setting they use their default depth ("medium" for gpt-oss) even for
// "hi", which held up simple questions. The user's effort setting picks the
// depth instead, with the default ("balanced") kept light.
const REASONING_EFFORT = { quick: "low", balanced: "low", deep: "medium", max: "high" };

// Models that stream their own reasoning, so the orchestrator doesn't also
// ask them for a <think> block (that made them deliberate twice per reply).
const REASONING_MODEL = /gpt-oss|(^|\/)o\d|gpt-5|deepseek-r1|reasoner|thinking|qwq|magistral/i;

function currentModel() {
  return acceptedModel || config.airouterModel || DEFAULT_MODEL;
}

function reasonsNatively() {
  return REASONING_MODEL.test(currentModel());
}

// A model that doesn't take the reasoning setting is retried once without it,
// and isn't sent it again.
function isReasoningRejected(status, detail) {
  return [400, 422].includes(status) && /reasoning/i.test(detail);
}
const rejectedReasoning = new Set();

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

// The model AI Router last accepted after a refusal, reused so later
// requests don't pay for the same rejection first.
let acceptedModel = null;

// Tolerates the usual paste mistakes in the env var: whitespace, quotes, "Bearer ".
function apiKey() {
  const key = String(config.airouterApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!key) {
    throw new ApiError(500, "AI Router API key not configured.");
  }
  return key;
}

async function generateStream(messages, options = {}) {
  const key = apiKey();

  const { temperature, maxTokens, model, effort } = options;
  const setting = { effort: REASONING_EFFORT[effort] || REASONING_EFFORT.balanced };
  // Only reasoning models get the setting; others may refuse the whole request.
  const reasoningFor = (modelName) => (REASONING_MODEL.test(modelName) && !rejectedReasoning.has(modelName) ? setting : null);
  const request = (modelName, reasoning = reasoningFor(modelName)) => fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature: temperature ?? config.airouterTemperature ?? 0.7,
      max_tokens: maxTokens ?? config.airouterMaxTokens ?? 8192,
      stream: true,
      ...(reasoning ? { reasoning } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });

  try {
    let modelName = model || currentModel();
    let res = await request(modelName);

    if (!res.ok) {
      let detail = await res.text();
      if (reasoningFor(modelName) && isReasoningRejected(res.status, detail)) {
        logger.warn("airouterAdapter.reasoningRejected", { model: modelName, status: res.status });
        rejectedReasoning.add(modelName);
        res = await request(modelName);
        if (!res.ok) detail = await res.text();
      }
      if (!res.ok && isUnknownModelError(res.status, detail) && modelName !== DEFAULT_MODEL) {
        logger.warn("airouterAdapter.modelRejected", { model: modelName, status: res.status, retryWith: DEFAULT_MODEL });
        modelName = DEFAULT_MODEL;
        res = await request(modelName);
        if (res.ok) acceptedModel = modelName;
        else detail = await res.text();
      }
      for (const fallbackMs of rateLimitDelaysMs) {
        if (res.ok || !isTransientRateLimit(res.status, detail)) break;
        const waitMs = retryDelay(res, fallbackMs);
        logger.warn("airouterAdapter.rateLimited", { model: modelName, retryInMs: waitMs });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        res = await request(modelName);
        if (!res.ok) detail = await res.text();
      }
      if (!res.ok) {
        throw new Error(`AI Router service error: ${res.status} ${detail.slice(0, 300)}`);
      }
    }

    return res.body;
  } catch (err) {
    logger.error("airouterAdapter.generateStream", { error: err.message });
    throw err;
  }
}

// Non-streaming completion for short side tasks (chat titles, follow-ups,
// research planning). No reasoning setting: these want a quick, direct answer.
async function complete(messages, { temperature = 0.4, maxTokens = 120 } = {}) {
  const key = apiKey();
  const send = (modelName) => fetch(endpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelName, messages, temperature, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(15000),
  });

  let modelName = currentModel();
  let res = await send(modelName);
  let detail = res.ok ? "" : await res.text();
  if (!res.ok && isUnknownModelError(res.status, detail) && modelName !== DEFAULT_MODEL) {
    logger.warn("airouterAdapter.modelRejected", { model: modelName, status: res.status, retryWith: DEFAULT_MODEL });
    modelName = DEFAULT_MODEL;
    res = await send(modelName);
    if (res.ok) acceptedModel = modelName;
    else detail = await res.text();
  }
  for (const fallbackMs of rateLimitDelaysMs) {
    if (res.ok || !isTransientRateLimit(res.status, detail)) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelay(res, fallbackMs)));
    res = await send(modelName);
    detail = res.ok ? "" : await res.text();
  }
  if (!res.ok) {
    throw new ApiError(res.status, `AI Router service error: ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

module.exports = {
  generateStream,
  complete,
  reasonsNatively,
  DEFAULT_MODEL,
  resetAcceptedModel: () => { acceptedModel = null; rejectedReasoning.clear(); },
  // Tests shorten the pauses between rate-limit retries.
  setRateLimitDelays: (delays) => { rateLimitDelaysMs = delays; },
};
