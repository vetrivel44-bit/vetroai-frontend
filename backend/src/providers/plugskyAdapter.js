const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Plugsky's own default model. Used when nothing is configured, and as a
// one-time retry when Plugsky rejects the configured model name.
const DEFAULT_MODEL = "plugsky-pro";

// Plugsky exposes an OpenAI-compatible /chat/completions endpoint, so the
// stream is handed back untouched and parsed by AIOrchestrator.pipeStream.
// Reasoning-capable models emit `delta.reasoning_content` (or `delta.reasoning`)
// alongside `delta.content`; the orchestrator routes those into the thinking panel.
function endpoint() {
  const base = (config.plugskyBaseUrl || "https://api.plugsky.com/v1").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function isUnknownModelError(status, detail) {
  return [400, 404, 422].includes(status) && /model/i.test(detail);
}

// Plugsky names the model a plan allows when it refuses one, e.g.
// 'Model "plugsky-pro" is not available on your "free" plan (cap: plugsky-lite)'.
function planCapModel(detail) {
  return /cap:\s*([a-z0-9][a-z0-9._-]*)/i.exec(detail)?.[1] || null;
}

// The model Plugsky last accepted after a refusal, reused so later requests
// don't pay for the same rejection first.
let acceptedModel = null;

async function generateStream(messages, options = {}) {
  // Tolerates the usual paste mistakes in the env var: whitespace, quotes, "Bearer ".
  const apiKey = String(config.plugskyApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) {
    throw new ApiError(500, "Plugsky API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const request = (modelName) => fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature: temperature ?? config.plugskyTemperature ?? 0.7,
      max_tokens: maxTokens ?? config.plugskyMaxTokens ?? 8192,
      stream: true,
    }),
    signal: AbortSignal.timeout(30000),
  });

  try {
    let modelName = model || acceptedModel || config.plugskyModel || DEFAULT_MODEL;
    let res = await request(modelName);

    if (!res.ok) {
      let detail = await res.text();
      if (isUnknownModelError(res.status, detail)) {
        const retryWith = planCapModel(detail) || DEFAULT_MODEL;
        if (retryWith !== modelName) {
          logger.warn("plugskyAdapter.modelRejected", { model: modelName, status: res.status, retryWith });
          modelName = retryWith;
          res = await request(modelName);
          if (res.ok) acceptedModel = modelName;
          else detail = await res.text();
        }
      }
      if (!res.ok) {
        throw new Error(`Plugsky service error: ${res.status} ${detail.slice(0, 300)}`);
      }
    }

    return res.body;
  } catch (err) {
    logger.error("plugskyAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
  DEFAULT_MODEL,
  resetAcceptedModel: () => { acceptedModel = null; },
};
