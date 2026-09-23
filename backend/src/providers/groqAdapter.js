const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");
const { withGroqModel } = require("../utils/groqModel");

const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;

async function generateStream(messages, options = {}) {
  if (!groq) {
    throw new ApiError(500, "Groq API key not configured.");
  }

  const { temperature, maxTokens, model } = options;

  try {
    const stream = await withGroqModel(groq, model || config.groqModel || "llama-3.3-70b-versatile", (modelName) =>
      groq.chat.completions.create({
        model: modelName,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: Math.min(maxTokens ?? 1024, 8192), // cap for free tier rate limits
        stream: true,
      }));

    return stream;
  } catch (err) {
    logger.error("groqAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
};
