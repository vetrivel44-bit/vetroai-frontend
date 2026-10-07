const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Used when nothing is configured, and as a one-time retry when the gateway
// rejects the configured model name. Gateway model ids are "provider/model".
const DEFAULT_MODEL = "openai/gpt-oss-120b";

// Vercel AI Gateway exposes an OpenAI-compatible /chat/completions endpoint,
// so the stream is handed back untouched and parsed by AIOrchestrator.pipeStream.
// Reasoning models emit `delta.reasoning` (or `delta.reasoning_content`)
// alongside `delta.content`; the orchestrator routes those into the thinking panel.
function endpoint() {
  const base = (config.vercelBaseUrl || "https://ai-gateway.vercel.sh/v1").replace(/\/+$/, "");
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
  return acceptedModel || config.vercelModel || DEFAULT_MODEL;
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

// The model the gateway last accepted after a refusal, reused so later
// requests don't pay for the same rejection first.
let acceptedModel = null;

async function generateStream(messages, options = {}) {
  // Tolerates the usual paste mistakes in the env var: whitespace, quotes, "Bearer ".
  const apiKey = String(config.vercelApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) {
    throw new ApiError(500, "Vercel AI Gateway API key not configured.");
  }

  const { temperature, maxTokens, model, effort } = options;
  const setting = { effort: REASONING_EFFORT[effort] || REASONING_EFFORT.balanced };
  // Only reasoning models get the setting; others may refuse the whole request.
  const reasoningFor = (modelName) => (REASONING_MODEL.test(modelName) && !rejectedReasoning.has(modelName) ? setting : null);
  const request = (modelName, reasoning = reasoningFor(modelName)) => fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature: temperature ?? config.vercelTemperature ?? 0.7,
      max_tokens: maxTokens ?? config.vercelMaxTokens ?? 8192,
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
        logger.warn("vercelAdapter.reasoningRejected", { model: modelName, status: res.status });
        rejectedReasoning.add(modelName);
        res = await request(modelName);
        if (!res.ok) detail = await res.text();
      }
      if (!res.ok && isUnknownModelError(res.status, detail) && modelName !== DEFAULT_MODEL) {
        logger.warn("vercelAdapter.modelRejected", { model: modelName, status: res.status, retryWith: DEFAULT_MODEL });
        modelName = DEFAULT_MODEL;
        res = await request(modelName);
        if (res.ok) acceptedModel = modelName;
        else detail = await res.text();
      }
      for (const fallbackMs of rateLimitDelaysMs) {
        if (res.ok || !isTransientRateLimit(res.status, detail)) break;
        const waitMs = retryDelay(res, fallbackMs);
        logger.warn("vercelAdapter.rateLimited", { model: modelName, retryInMs: waitMs });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        res = await request(modelName);
        if (!res.ok) detail = await res.text();
      }
      if (!res.ok) {
        throw new Error(`Vercel AI Gateway service error: ${res.status} ${detail.slice(0, 300)}`);
      }
    }

    return res.body;
  } catch (err) {
    logger.error("vercelAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
  reasonsNatively,
  DEFAULT_MODEL,
  resetAcceptedModel: () => { acceptedModel = null; rejectedReasoning.clear(); },
  // Tests shorten the pauses between rate-limit retries.
  setRateLimitDelays: (delays) => { rateLimitDelaysMs = delays; },
};
