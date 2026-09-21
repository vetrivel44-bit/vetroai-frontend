const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Mistral rejects any model id it doesn't recognize with a 4xx — a typo'd
// MISTRAL_MODEL env var (e.g. a placeholder like "mistral-1" left over from
// .env.example) would otherwise silently break every call. Guard against
// that by falling back to a known-good model instead of sending it through.
const KNOWN_MISTRAL_MODELS = new Set([
  "mistral-large-latest",
  "mistral-medium-latest",
  "mistral-small-latest",
  "open-mistral-7b",
  "open-mixtral-8x7b",
  "open-mixtral-8x22b",
  "codestral-latest",
  "ministral-3b-latest",
  "ministral-8b-latest",
]);
const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";

function resolveModel(requested) {
  const model = requested || config.mistralModel || DEFAULT_MISTRAL_MODEL;
  if (KNOWN_MISTRAL_MODELS.has(model)) return model;
  logger.warn("mistralAdapter: unrecognized MISTRAL_MODEL, falling back to default", {
    configured: model,
    fallback: DEFAULT_MISTRAL_MODEL,
  });
  return DEFAULT_MISTRAL_MODEL;
}

async function generateStream(messages, options = {}) {
  // Read the key at call time, not at module load. ProviderManager.isConfigured
  // checks it dynamically, so a snapshot taken here could disagree with it and
  // leave the orchestrator routing to an adapter that then refuses the work.
  if (!config.mistralApiKey) {
    throw new ApiError(500, "Mistral API key not configured on the backend.");
  }

  const { temperature, maxTokens, model } = options;
  const endpoint = "https://api.mistral.ai/v1/chat/completions";
  const body = {
    model: resolveModel(model),
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 2048,
    stream: true,
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mistralApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Mistral service error: ${res.status} ${detail}`);
    }

    return res.body;
  } catch (err) {
    logger.error("mistralAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
};
