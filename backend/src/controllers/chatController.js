const Groq = require("groq-sdk");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");
const { performDeepSearch } = require("../services/deepSearchService");

// ── Groq client ───────────────────────────────────────────────────────────────
if (!config.groqApiKey) {
  logger.warn("chatController.init", { note: "GROQ_API_KEY not set — chat requests will fail." });
}
const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
const mistralAvailable = Boolean(config.mistralApiKey);

const MODEL_ALIASES = {
  fast_chat:    "llama-3.1-8b-instant",
  vtu_academic: "llama-3.3-70b-versatile",
  debugger:     "llama-3.3-70b-versatile",
  creative:     "llama-3.3-70b-versatile",
  analyst:      "llama-3.3-70b-versatile",
  web_search:   "llama-3.1-8b-instant",
  deep_search:  "llama-3.3-70b-versatile",
  youtube:      "llama-3.3-70b-versatile",
  translator:   "llama-3.3-70b-versatile",
  interviewer:  "llama-3.3-70b-versatile",
  astrology:    "llama-3.1-8b-instant",
  medical:      "llama-3.3-70b-versatile",
  vision:       "llama-3.2-11b-vision-preview",
  code_exec:    "llama-3.3-70b-versatile",
  persona:      "llama-3.3-70b-versatile",
};

const SAFE_PATTERNS = [
  /ignore (all|previous|prior) instructions/gi,
  /reveal (system|hidden) prompt/gi,
  /developer instructions/gi,
];

const ALLOWED_ATTACHMENT_TYPES = new Set([
  "text/plain", "text/markdown", "text/csv",
  "application/json", "application/javascript",
  "application/pdf", "application/x-pdf",
]);

function normalizeModel(inputModel) {
  const fallback = config.groqModel || "llama-3.3-70b-versatile";
  if (!inputModel) return fallback;
  return MODEL_ALIASES[inputModel] || inputModel;
}

function normalizeMessages(rawMessages, input) {
  let parsed = [];
  if (rawMessages) {
    try { parsed = JSON.parse(rawMessages); }
    catch { throw new ApiError(400, "Invalid messages payload"); }
  }
  if (!Array.isArray(parsed)) parsed = [];
  const clean = parsed
    .filter((m) => m && typeof m.content === "string" && ["system", "user", "assistant"].includes(m.role))
    .slice(-18)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));

  if (input && typeof input === "string" && input.trim()) {
    const last = clean[clean.length - 1];
    if (!last || last.role !== "user" || last.content.trim() !== input.trim()) {
      clean.push({ role: "user", content: input.trim().slice(0, 12000) });
    }
  }
  return clean;
}

function sanitizePrompt(input, safeMode) {
  if (!safeMode || !input) return input;
  let out = input;
  SAFE_PATTERNS.forEach((pattern) => { out = out.replace(pattern, "[filtered]"); });
  return out;
}

function getAttachmentContext(file) {
  if (!file) return null;
  const isTextLike = file.mimetype.startsWith("text/") || ALLOWED_ATTACHMENT_TYPES.has(file.mimetype);
  if (!isTextLike && !file.mimetype.startsWith("image/")) {
    throw new ApiError(400, "Unsupported attachment type. Use txt, md, csv, json, pdf, or images.");
  }
  if (file.mimetype.startsWith("image/")) {
    return `[IMAGE ATTACHED: ${file.originalname} (${Math.round(file.size / 1024)}KB)]\nPlease describe or analyze this image as requested by the user.`;
  }
  const text = file.buffer.toString("utf-8").trim();
  if (!text) return null;
  return `Attached file (${file.originalname}):\n${text.slice(0, 12000)}`;
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function withRetry(operation, retries = 2, delay = 1000) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(); }
    catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const isRateLimit = err.status === 429 || err.message?.includes("429") || err.message?.includes("Rate limit");
      if (isRateLimit) {
        logger.warn(`Rate limit hit, retrying in ${delay * (attempt + 1)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

async function callMistralChat({ messages, temperature, maxTokens, model }) {
  if (!mistralAvailable) throw new Error("Mistral API key not configured.");
  const endpoint = "https://api.mistral.ai/v1/chat/completions";
  const body = {
    model: model || config.mistralModel || "mistral-small-latest",
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
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
    const err = new Error(`Mistral service error: ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
}

async function callMistralChatStream({ messages, temperature, maxTokens, model }) {
  if (!mistralAvailable) throw new Error("Mistral API key not configured.");
  const endpoint = "https://api.mistral.ai/v1/chat/completions";
  const body = {
    model: model || config.mistralModel || "mistral-small-latest",
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };
  const res = await withRetry(
    () => fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mistralApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    2
  );
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`Mistral service error: ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  return res.body;
}

async function callSambaNovaChat({ messages, temperature, maxTokens, model }) {
  if (!config.sambanovaApiKey) throw new Error("SambaNova API key not configured.");
  const endpoint = "https://api.sambanova.ai/v1/chat/completions";
  const body = {
    model: model || "Meta-Llama-3.1-70B-Instruct",
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 2048,
    stream: false,
  };
  const res = await withRetry(
    () => fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.sambanovaApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    2
  );
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`SambaNova service error: ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
}

async function callGeminiChatStream({ messages, temperature, maxTokens, model }) {
  if (!config.geminiApiKey) throw new Error("Gemini API key not configured.");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-flash"}:streamGenerateContent?key=${config.geminiApiKey}`;
  
  const contents = messages.map(msg => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }]
  }));

  const body = {
    contents,
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens ?? 2048,
    }
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`Gemini service error: ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }

  return res.body;
}

function routeQuery(prompt, hasImage) {
  if (hasImage) return "gemini";
  
  const lower = prompt.toLowerCase();
  
  // Coding / Complex Reasoning intent
  const codingKeywords = ["javascript", "python", "java", "c++", "html", "css", "react", "node", "function", "class", "debug", "error", "code", "write a", "implement"];
  const isCode = codingKeywords.some(kw => lower.includes(kw)) || prompt.includes("```");
  
  // DeepSearch intent
  const deepSearchKeywords = ["research", "deep search", "analyze", "compare", "latest", "best", "guide", "full roadmap", "explain deeply", "current", "news", "top", "vs", "pros and cons", "data analysis", "trends", "statistics", "growth"];
  
  if (!isCode && (deepSearchKeywords.some(kw => lower.includes(kw)) || prompt.length > 300)) {
    return "deep_search";
  }
  
  // Live info / Maps intent
  const liveKeywords = ["weather", "map", "location", "directions", "where is", "navigate"];
  if (liveKeywords.some(kw => lower.includes(kw))) {
    return "gemini";
  }
  
  // Simple / Fast intent
  const simpleKeywords = ["hi", "hello", "hey", "thanks", "thank you", "bye"];
  if (prompt.length < 30 || simpleKeywords.some(kw => lower === kw || lower.startsWith(kw + " "))) {
    return "groq";
  }
  
  // Default to Mistral for complex/reasoning
  return "mistral";
}

// ── MAIN CHAT HANDLER ─────────────────────────────────────────────────────────
async function chat(req, res) {
  const startedAt = Date.now();
  const reqId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const model = normalizeModel(req.body?.model);
  const safeMode = String(req.body?.safeMode || "false") === "true";
  const temperature = Number(req.body?.temperature ?? config.groqTemperature);
  const rawMax = Number(req.body?.maxTokens ?? config.groqMaxTokens);
  const maxTokens = Math.min(rawMax, 8192);
  const input = sanitizePrompt(req.body?.input || "", safeMode);
  const messages = normalizeMessages(req.body?.messages, input);
  const attachmentContext = getAttachmentContext(req.file);
  if (attachmentContext) messages.push({ role: "user", content: attachmentContext });

  if (!messages.length) throw new ApiError(400, "No valid messages provided");

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const heartbeat = setInterval(() => { res.write(": ping\n\n"); }, 12000);
  const cleanup = () => { clearInterval(heartbeat); };

  if (!groq && !mistralAvailable) {
    cleanup();
    sseWrite(res, { content: "⚠️ AI service not configured. Please set GROQ_API_KEY or MISTRAL_API_KEY in the backend .env file and restart the server." });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const hasImage = Boolean(req.file);
  const routedModel = routeQuery(input, hasImage);

  logger.info("chat.request.started", {
    reqId, userId: req.user?.id || "anon", model,
    messages: messages.length, hasAttachment: hasImage,
    routedModel,
  });

  const useGroqFirst = routedModel === "groq";
  const useGemini = routedModel === "gemini";
  const useDeepSearch = routedModel === "deep_search";

  try {
    if (useDeepSearch) {
      // Use DeepSearch
      const { context } = await performDeepSearch(input);
      
      const systemPrompt = "You are a premium AI research assistant. Synthesize the findings from the web search and generate a structured research-style answer. Use bullet points, comparisons, pros/cons, and citations where useful.\n\n" +
        "## WEB SEARCH + GRAPH INTEGRATION RULES\n" +
        "If you decide to generate a chart (based on the VISUALIZATION RULES), you MUST act as a web-data extraction layer and strictly follow these rules:\n" +
        "1. **Never directly pass raw web-search text into charts**. You must parse, structure, validate, and normalize the data first.\n" +
        "2. **AI-Powered Schema Generation**: Convert text claims into clean JSON datasets. E.g., \"Bitcoin rose from $42,000 in Jan 2024 to $95,000 in Dec 2025\" -> `[{\"label\": \"Jan 2024\", \"value\": 42000}, {\"label\": \"Dec 2025\", \"value\": 95000}]`.\n" +
        "3. **Validation**: Ensure all data points have valid labels and numeric values. NEVER use \"Unknown\" as a label if you can avoid it. Never render empty or broken analytics.\n" +
        "4. **Time-Series Extraction**: For trend charts, detect chronological order, parse month/year correctly, and sort dates automatically.\n" +
        "5. **Source-Aware Parsing**: Extract meaningful structured datasets from news, Wikipedia, or financial snippets provided in the search results.\n\n" +
        "IMPORTANT: Do NOT include search sources or context inside code blocks. Code blocks should contain ONLY clean, working code or valid JSON for charts as specified in the VISUALIZATION RULES. If you create tables, ALWAYS use proper Markdown table syntax with a header row and a separator row. Never output raw pipes without structure. Please respect the VISUALIZATION RULES provided in the message history for generating charts.";
      const messagesWithContext = [
        { role: "system", content: systemPrompt },
        ...messages,
        { role: "user", content: `Web Search Results:\n${context}\n\nPlease synthesize and answer the original query.` }
      ];
      
      const stream = await callMistralChatStream({ messages: messagesWithContext, temperature, maxTokens, model: config.mistralModel });
      
      let tokenCount = 0;
      let buffer = "";
      
      for await (const chunk of stream) {
        buffer += new TextDecoder("utf-8").decode(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr.trim() === "[DONE]") break;
            try {
              const data = JSON.parse(dataStr);
              const content = data.choices?.[0]?.delta?.content || "";
              if (content) {
                tokenCount++;
                sseWrite(res, { content });
              }
            } catch (e) {
              // ignore parse errors for incomplete chunks
            }
          }
        }
      }
      
      res.write("data: [DONE]\n\n");
      res.end();
      cleanup();
      logger.info("chat.request.completed", {
        reqId, model: config.mistralModel, streamChunks: tokenCount, provider: "DeepSearch (Mistral)", latencyMs: Date.now() - startedAt,
      });
      return;
    } else if (useGemini) {
      // ... keep gemini block ...
      const stream = await callGeminiChatStream({ messages, temperature, maxTokens, model: "gemini-1.5-flash" });
      
      let tokenCount = 0;
      let buffer = "";
      
      for await (const chunk of stream) {
        buffer += new TextDecoder("utf-8").decode(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim() === "[" || line.trim() === "]" || line.trim() === ",") continue;
          let cleanedLine = line.trim();
          if (cleanedLine.startsWith(",")) cleanedLine = cleanedLine.slice(1).trim();
          
          try {
            const data = JSON.parse(cleanedLine);
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (content) {
              tokenCount++;
              sseWrite(res, { content });
            }
          } catch (e) {
            // ignore parse errors for incomplete chunks
          }
        }
      }
      
      res.write("data: [DONE]\n\n");
      res.end();
      cleanup();
      logger.info("chat.request.completed", {
        reqId, model: "gemini-1.5-flash", streamChunks: tokenCount, provider: "Gemini", latencyMs: Date.now() - startedAt,
      });
    } else if (useGroqFirst) {
      // ... keep groq block ...
      const stream = await withRetry(
        () => groq.chat.completions.create({
          model,
          messages,
          temperature: Number.isFinite(temperature) ? temperature : config.groqTemperature,
          max_tokens: Number.isFinite(maxTokens) ? maxTokens : config.groqMaxTokens,
          stream: true,
        }),
        1
      );

      let tokenCount = 0;
      for await (const chunk of stream) {
        const content = chunk?.choices?.[0]?.delta?.content || "";
        if (!content) continue;
        tokenCount++;
        sseWrite(res, { content });
      }

      res.write("data: [DONE]\n\n");
      res.end();
      cleanup();
      logger.info("chat.request.completed", {
        reqId, model, streamChunks: tokenCount, latencyMs: Date.now() - startedAt,
      });
    } else {
      // Use Mistral (Streaming)
      const endpoint = "https://api.mistral.ai/v1/chat/completions";
      const body = {
        model: config.mistralModel || "mistral-small-latest",
        messages,
        temperature: Number.isFinite(temperature) ? temperature : config.mistralTemperature,
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : config.mistralMaxTokens,
        stream: true,
      };
      
      const response = await withRetry(
        () => fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.mistralApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        1
      );

      if (!response.ok) {
        const detail = await response.text();
        const err = new Error(`Mistral service error: ${response.status} ${detail}`);
        err.status = response.status;
        throw err;
      }

      let buffer = "";
      let tokenCount = 0;
      
      for await (const chunk of response.body) {
        buffer += new TextDecoder("utf-8").decode(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr.trim() === "[DONE]") break;
            try {
              const data = JSON.parse(dataStr);
              const content = data.choices[0].delta.content || "";
              if (content) {
                tokenCount++;
                sseWrite(res, { content });
              }
            } catch (e) {
              // ignore parse errors for incomplete chunks
            }
          }
        }
      }
      
      res.write("data: [DONE]\n\n");
      res.end();
      cleanup();
      logger.info("chat.request.completed", {
        reqId, model: body.model, streamChunks: tokenCount, provider: "Mistral", latencyMs: Date.now() - startedAt,
      });
    }
  } catch (err) {
    // Fallback logic
    logger.error("chat.request.failed", { reqId, model, message: err.message, status: err.status });

    if (useGemini) {
      try {
        logger.info("chat.fallback.mistral", { reqId });
        const fallbackModel = config.mistralModel || "mistral-small-latest";
        const output = await callMistralChat({ messages, temperature, maxTokens, model: fallbackModel });
        sseWrite(res, { content: output });
        res.write("data: [DONE]\n\n");
        res.end();
        cleanup();
        return;
      } catch (merr) {
        logger.error("chat.fallback.failed.mistral", { reqId, message: merr.message });
      }
    } else if (useDeepSearch || (!useGroqFirst && routedModel === "mistral")) {
      // If Mistral failed (in DeepSearch or normal mode), try SambaNova
      try {
        logger.info("chat.fallback.sambanova", { reqId });
        const output = await callSambaNovaChat({ messages, temperature, maxTokens });
        sseWrite(res, { content: output });
        res.write("data: [DONE]\n\n");
        res.end();
        cleanup();
        return;
      } catch (serr) {
        logger.error("chat.fallback.failed.sambanova", { reqId, message: serr.message });
        // Fallback to Groq if SambaNova failed
        try {
          logger.info("chat.fallback.groq", { reqId });
          const stream = await groq.chat.completions.create({
            model: config.groqModel || "llama-3.3-70b-versatile",
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: true,
          });
          for await (const chunk of stream) {
            const content = chunk?.choices?.[0]?.delta?.content || "";
            if (content) sseWrite(res, { content });
          }
          res.write("data: [DONE]\n\n");
          res.end();
          cleanup();
          return;
        } catch (gerr) {
          logger.error("chat.fallback.failed.groq", { reqId, message: gerr.message });
        }
      }
    } else if (useGroqFirst && mistralAvailable) {
      try {
        logger.info("chat.fallback.mistral", { reqId });
        const fallbackModel = config.mistralModel || "mistral-small-latest";
        const output = await callMistralChat({ messages, temperature, maxTokens, model: fallbackModel });
        sseWrite(res, { content: output });
        res.write("data: [DONE]\n\n");
        res.end();
        cleanup();
        return;
      } catch (merr) {
        logger.error("chat.fallback.failed.mistral", { reqId, message: merr.message });
      }
    }

    cleanup();
    let errMsg = "\n\n⚠️ **AI Error**: ";
    if (err.status === 429) {
      errMsg += "Rate limit reached. Please wait a moment and try again.";
    } else if (err.status === 401) {
      errMsg += "Invalid API key. Please check your configuration.";
    } else {
      errMsg += `${err.message || "Service error. Please try again."}`;
    }

    sseWrite(res, { content: errMsg });
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

async function generateTitle(req, res) {
  const firstMessage = String(req.body?.firstMessage || "").trim();
  if (!firstMessage) throw new ApiError(400, "firstMessage is required");

  if (!groq && mistralAvailable) {
    const completion = await callMistralChat({
      model: config.mistralModel,
      messages: [
        { role: "system", content: "Generate a short chat title with max 6 words. Include a relevant emoji at start. Return plain text only." },
        { role: "user", content: firstMessage.slice(0, 400) },
      ],
      temperature: config.mistralTemperature,
      maxTokens: 28,
    });
    const title = completion.trim().replace(/^["']|["']$/g, "").slice(0, 64) || "New Chat";
    return successResponse(res, "Title generated", { title });
  }

  const completion = await withRetry(
    () => groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.2, max_tokens: 28,
      messages: [
        { role: "system", content: "Generate a short chat title with max 6 words. Include a relevant emoji at start. Return plain text only." },
        { role: "user", content: firstMessage.slice(0, 400) },
      ],
    }),
    1
  );

  const title = completion?.choices?.[0]?.message?.content?.trim() || "New Chat";
  return successResponse(res, "Title generated", { title: title.replace(/^[\"']|[\"']$/g, "").slice(0, 64) });
}

async function followUps(req, res) {
  const lastMessage = String(req.body?.lastMessage || "").trim();
  const userQuery = String(req.body?.userQuery || "").trim();
  if (!lastMessage) throw new ApiError(400, "lastMessage is required");

  if (!groq && deepseekAvailable) {
    const completion = await callDeepSeekChat({
      model: config.deepseekModel,
      messages: [
        { role: "system", content: "Return exactly 4 concise follow-up questions as a JSON array of strings. No markdown, no extra keys." },
        { role: "user", content: `Original query: ${userQuery}\n\nAssistant answer: ${lastMessage.slice(0, 1400)}` },
      ],
      temperature: config.deepseekTemperature,
      maxTokens: 120,
    });
    let suggestions = [];
    try {
      const parsed = JSON.parse(completion);
      if (Array.isArray(parsed)) suggestions = parsed.filter((x) => typeof x === "string").slice(0, 4);
    } catch {
      suggestions = completion.split(/\n+/).map((l) => l.replace(/^[\-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 4);
    }
    return successResponse(res, "Follow-ups generated", { suggestions });
  }

  const completion = await withRetry(
    () => groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.5, max_tokens: 120,
      messages: [
        { role: "system", content: "Return exactly 4 concise follow-up questions as a JSON array of strings. No markdown, no extra keys." },
        { role: "user", content: `Original query: ${userQuery}\n\nAssistant answer: ${lastMessage.slice(0, 1400)}` },
      ],
    }),
    1
  );

  const raw = completion?.choices?.[0]?.message?.content || "[]";
  let suggestions = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) suggestions = parsed.filter((x) => typeof x === "string").slice(0, 4);
  } catch {
    suggestions = raw.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 4);
  }

  return successResponse(res, "Follow-ups generated", { suggestions });
}

module.exports = { chat, generateTitle, followUps };
