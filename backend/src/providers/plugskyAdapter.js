const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Plugsky exposes an OpenAI-compatible /chat/completions endpoint, so the
// stream is handed back untouched and parsed by AIOrchestrator.pipeStream.
// Reasoning-capable models emit `delta.reasoning_content` (or `delta.reasoning`)
// alongside `delta.content`; the orchestrator routes those into the thinking panel.
function endpoint() {
  const base = (config.plugskyBaseUrl || "https://api.plugsky.com/v1").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

async function generateStream(messages, options = {}) {
  const apiKey = config.plugskyApiKey;
  if (!apiKey) {
    throw new ApiError(500, "Plugsky API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const body = {
    model: model || config.plugskyModel || "plugsky-reasoner",
    messages,
    temperature: temperature ?? config.plugskyTemperature ?? 0.7,
    max_tokens: maxTokens ?? config.plugskyMaxTokens ?? 8192,
    stream: true,
  };

  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Plugsky service error: ${res.status} ${detail.slice(0, 300)}`);
    }

    return res.body;
  } catch (err) {
    logger.error("plugskyAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
};
