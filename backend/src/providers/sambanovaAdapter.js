const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");
const { chatCompletion } = require("./openaiCompatible");

async function generateStream(messages, options = {}) {
  if (!config.sambanovaApiKey) {
    throw new ApiError(500, "SambaNova API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const endpoint = "https://api.sambanova.ai/v1/chat/completions";
  
  const body = {
    model: model || "Meta-Llama-3.3-70B-Instruct",
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 2048,
    stream: true, // Attempting streaming
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.sambanovaApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`SambaNova service error: ${res.status} ${detail}`);
    }

    return res.body;
  } catch (err) {
    logger.error("sambanovaAdapter.generateStream", { error: err.message });
    throw err;
  }
}

// Non-streaming variant used by the agentic tool loop — see openaiCompatible.js.
async function generateCompletion(messages, options = {}) {
  if (!config.sambanovaApiKey) {
    throw new ApiError(500, "SambaNova API key not configured.");
  }

  const { model } = options;

  try {
    return await chatCompletion({
      label: "SambaNova",
      endpoint: "https://api.sambanova.ai/v1/chat/completions",
      apiKey: config.sambanovaApiKey,
      model: model || "Meta-Llama-3.3-70B-Instruct",
      messages,
      options,
      timeoutMs: 25000,
    });
  } catch (err) {
    logger.error("sambanovaAdapter.generateCompletion", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
  generateCompletion,
  supportsTools: true,
};
