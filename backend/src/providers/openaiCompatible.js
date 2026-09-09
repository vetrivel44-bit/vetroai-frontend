const logger = require("../utils/logger");

// Shared non-streaming /chat/completions caller for the OpenAI-compatible
// providers (mistral, sambanova, agnes, plugsky — groq goes through its SDK).
//
// The agentic loop needs a *blocking* call, not a stream: it has to see the
// whole `tool_calls` array before it can run anything, and there is nothing to
// show the user mid-step anyway. Streaming stays the path for the final answer.
async function chatCompletion({ label, endpoint, apiKey, model, messages, options = {}, timeoutMs = 30000, headers = {} }) {
  const { temperature, maxTokens, tools, toolChoice } = options;

  const body = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 2048,
    stream: false,
  };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = toolChoice || "auto";
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${label} service error: ${res.status} ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  if (!message) {
    logger.warn("openaiCompatible.noMessage", { label });
    throw new Error(`${label} returned no message in the completion response`);
  }
  return message;
}

module.exports = { chatCompletion };
