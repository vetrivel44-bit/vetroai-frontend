const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_MODEL = "mistral-small-latest";
// Tried in order when the configured model is rejected or out of capacity.
// On the free ("Experiment") tier Mistral regularly answers 429 "Service tier
// capacity exceeded for this model" for its most popular model while smaller
// ones still have room — the account has credit, the model is just full.
const FALLBACK_MODELS = [DEFAULT_MODEL, "ministral-8b-latest", "open-mistral-nemo"];

// Mistral's free tier allows about one request per second, so a 429 is often
// just this request landing next to a title or follow-up call. Retried after a
// pause (Retry-After when sent, capped) before trying another model.
let rateLimitDelaysMs = [1200, 2500];
const MAX_RETRY_AFTER_MS = 6000;

function isRateLimit(status, detail) {
  return status === 429 && !/per day|daily|monthly|quota|billing|payment/i.test(detail);
}

function isCapacityLimit(detail) {
  return /capacity|service_tier/i.test(detail);
}

function isRejectedModel(status, detail) {
  return (status === 400 || status === 404) && /invalid[ _-]?model|model.*(not found|does not exist|no longer)|unknown model/i.test(detail);
}

function retryDelay(res, fallbackMs) {
  const seconds = Number(res.headers?.get?.("retry-after"));
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

// A model Mistral accepted after the configured one was rejected as invalid,
// reused so later requests don't pay for the same rejection first.
let acceptedModel = null;

function candidateModels(requested) {
  const first = requested || acceptedModel || config.mistralModel || DEFAULT_MODEL;
  return [...new Set([first, ...FALLBACK_MODELS])];
}

// Sends one chat completion to Mistral, walking the model list on a rejected
// model name or a model that stays out of capacity. Returns the fetch Response
// of the first request that succeeds; throws with the last error otherwise.
async function request(body, { timeoutMs, model } = {}) {
  if (!config.mistralApiKey) {
    throw new ApiError(500, "Mistral API key not configured on the backend.");
  }

  const send = (modelName) => fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mistralApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, model: modelName }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let lastStatus = 0;
  let lastDetail = "";
  // Only a rejected model name is worth remembering; a full model recovers.
  let switchedForCapacity = false;
  for (const modelName of candidateModels(model)) {
    let res = await send(modelName);
    let detail = res.ok ? "" : await res.text();

    for (const fallbackMs of rateLimitDelaysMs) {
      if (res.ok || !isRateLimit(res.status, detail)) break;
      const waitMs = retryDelay(res, fallbackMs);
      logger.warn("mistralAdapter.rateLimited", { model: modelName, retryInMs: waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      res = await send(modelName);
      detail = res.ok ? "" : await res.text();
    }

    if (res.ok) {
      if (lastStatus && !switchedForCapacity) acceptedModel = modelName;
      return res;
    }

    lastStatus = res.status;
    lastDetail = detail;
    const full = isRateLimit(res.status, detail) && isCapacityLimit(detail);
    if (!full && !isRejectedModel(res.status, detail)) break;
    if (full) switchedForCapacity = true;
    logger.warn("mistralAdapter.switchingModel", { model: modelName, status: res.status });
  }

  throw new ApiError(lastStatus || 502, `Mistral service error: ${lastStatus} ${lastDetail.slice(0, 300)}`);
}

async function generateStream(messages, options = {}) {
  const { temperature, maxTokens, model } = options;
  try {
    const res = await request({
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 2048,
      stream: true,
    }, { timeoutMs: 25000, model });
    return res.body;
  } catch (err) {
    logger.error("mistralAdapter.generateStream", { error: err.message });
    throw err;
  }
}

// Non-streaming completion for short side tasks (chat titles, follow-ups).
async function complete(messages, { temperature = 0.4, maxTokens = 120 } = {}) {
  const res = await request({
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  }, { timeoutMs: 15000 });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

module.exports = {
  generateStream,
  complete,
  DEFAULT_MODEL,
  resetAcceptedModel: () => { acceptedModel = null; },
  // Tests shorten the pauses between rate-limit retries.
  setRateLimitDelays: (delays) => { rateLimitDelaysMs = delays; },
};
