const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const mistralAvailable = Boolean(config.mistralApiKey);

async function generateStream(messages, options = {}) {
  if (!mistralAvailable) {
    throw new ApiError(500, "Mistral API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const endpoint = "https://api.mistral.ai/v1/chat/completions";
  const body = {
    model: model || config.mistralModel || "mistral-small-latest",
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
