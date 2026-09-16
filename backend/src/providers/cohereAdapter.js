const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Cohere's OpenAI-compatible endpoint — same request/response shape as the
// other REST adapters (sambanova, plugsky), so AIOrchestrator's SSE parsing
// needs no special-casing for this provider.
const COHERE_ENDPOINT = "https://api.cohere.ai/compatibility/v1/chat/completions";

// Computer mode attaches the current screenshot as `images: [{mimeType, data}]`
// (see chatController). Translate that into the OpenAI multimodal content
// array so the screen-control agent can fall back to Cohere and still actually
// see the screen, rather than guessing at what's in front of it.
function toContent(message) {
  const images = Array.isArray(message.images) ? message.images.filter((img) => img?.data && img?.mimeType) : [];
  if (!images.length) return message.content;

  const parts = [];
  if (message.content) parts.push({ type: "text", text: message.content });
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
  }
  return parts;
}

async function generateStream(messages, options = {}) {
  if (!config.cohereApiKey) {
    throw new ApiError(500, "Cohere API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const hasImages = messages.some((m) => Array.isArray(m.images) && m.images.length);

  // Rebuilt rather than spread, so the custom `images` key never reaches
  // Cohere — it only understands the content array built above.
  const payloadMessages = messages.map((message) => ({
    role: message.role,
    content: toContent(message),
  }));

  const body = {
    // The text default can't read an image, so a request carrying a
    // screenshot has to go to the vision model instead.
    model: model || (hasImages ? config.cohereVisionModel : config.cohereModel),
    messages: payloadMessages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 2048,
    stream: true,
  };

  try {
    const res = await fetch(COHERE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.cohereApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // A screenshot makes the request far bigger and slower to process than a
      // text turn, so it gets a longer ceiling before being called a timeout.
      signal: AbortSignal.timeout(hasImages ? 45000 : 25000),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Cohere service error: ${res.status} ${detail}`);
    }

    return res.body;
  } catch (err) {
    logger.error("cohereAdapter.generateStream", { error: err.message, hasImages });
    throw err;
  }
}

module.exports = {
  generateStream,
};
