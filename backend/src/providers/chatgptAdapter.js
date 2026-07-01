const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const API_URL = "https://chatgpt-42.p.rapidapi.com/conversationgpt4-2";

async function* generateStream(messages, options = {}) {
  const apiKey = config.chatgptApiKey;
  if (!apiKey) {
    throw new ApiError(500, "ChatGPT API key not configured.");
  }

  // Extract system prompt from messages if present
  const systemMessage = messages.find(m => m.role === "system");
  const systemPrompt = systemMessage ? systemMessage.content : "";

  // Remove system message and keep only user/assistant messages for the API format if needed,
  // but it seems the API takes messages array. The screenshot payload had "system_prompt" as a separate field.
  const userMessages = messages.filter(m => m.role !== "system");

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'chatgpt-42.p.rapidapi.com',
        'x-rapidapi-key': apiKey
      },
      body: JSON.stringify({
        messages: userMessages,
        system_prompt: systemPrompt,
        temperature: options.temperature ?? 0.9,
        top_k: 5,
        top_p: 0.9,
        max_tokens: Math.min(options.maxTokens ?? 1024, 8192),
        web_access: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ChatGPT API Error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    // Check if the API returns a standard format or specific to this RapidAPI wrapper
    // We assume data.result or data.message or it's just standard OpenAI format.
    // If it's standard OpenAI format, it's data.choices[0].message.content
    // Since we don't have the exact response schema, let's try standard locations
    let content = "";
    if (data.result) {
      content = data.result;
    } else if (data.message) {
      content = data.message;
    } else if (data.choices && data.choices[0] && data.choices[0].message) {
      content = data.choices[0].message.content;
    } else {
      content = JSON.stringify(data);
    }

    // Simulate streaming by yielding chunks so the UI doesn't appear frozen
    const chunks = content.split(/(?<=\s)/); // Split by whitespace while keeping the space
    for (let i = 0; i < chunks.length; i += 3) {
      const chunkStr = chunks.slice(i, i + 3).join("");
      yield { text: chunkStr };
      // Small artificial delay to create typing effect (10ms)
      await new Promise(r => setTimeout(r, 10));
    }
  } catch (err) {
    logger.error("chatgptAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
};
