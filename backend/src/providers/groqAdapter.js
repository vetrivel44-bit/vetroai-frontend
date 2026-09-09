const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;

async function generateStream(messages, options = {}) {
  if (!groq) {
    throw new ApiError(500, "Groq API key not configured.");
  }

  const { temperature, maxTokens, model } = options;

  try {
    const stream = await groq.chat.completions.create({
      model: model || config.groqModel || "llama-3.1-8b-instant",
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: Math.min(maxTokens ?? 1024, 8192), // cap for free tier rate limits
      stream: true,
    });

    return stream;
  } catch (err) {
    logger.error("groqAdapter.generateStream", { error: err.message });
    throw err;
  }
}

// Non-streaming variant used by the agentic tool loop. Groq's SDK speaks the
// OpenAI tool-calling shape directly, so the message comes back with a
// `tool_calls` array when the model wants to use one.
async function generateCompletion(messages, options = {}) {
  if (!groq) {
    throw new ApiError(500, "Groq API key not configured.");
  }

  const { temperature, maxTokens, model, tools, toolChoice } = options;

  const payload = {
    model: model || config.groqModel || "llama-3.1-8b-instant",
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: Math.min(maxTokens ?? 1024, 8192),
    stream: false,
  };
  if (Array.isArray(tools) && tools.length) {
    payload.tools = tools;
    payload.tool_choice = toolChoice || "auto";
  }

  try {
    const completion = await groq.chat.completions.create(payload);
    const message = completion?.choices?.[0]?.message;
    if (!message) throw new Error("Groq returned no message in the completion response");
    return message;
  } catch (err) {
    logger.error("groqAdapter.generateCompletion", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
  generateCompletion,
  supportsTools: true,
};
