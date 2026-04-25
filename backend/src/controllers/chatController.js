const Groq = require("groq-sdk");
const https = require("https");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");

// ── Groq client (only if key is available) ────────────────────────────────────
const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;

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
  vision:       "llama-3.2-11b-vision-preview",
  code_exec:    "llama-3.3-70b-versatile",
  persona:      "llama-3.3-70b-versatile",
};

// Pollinations model mapping (free, no key required)
const POLLINATIONS_MODEL_MAP = {
  "llama-3.1-8b-instant":     "llama",
  "llama-3.3-70b-versatile":  "llama",
  "llama-3.2-11b-vision-preview": "llama",
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

async function withRetry(operation, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(); }
    catch (err) { lastErr = err; if (attempt === retries) break; }
  }
  throw lastErr;
}

// ── Pollinations.ai streaming (free, no API key) ──────────────────────────────
function streamFromPollinations(messages, model, temperature, res, onChunk, onDone, onError) {
  const pollinationsModel = POLLINATIONS_MODEL_MAP[model] || "openai-large";
  const body = JSON.stringify({
    model: pollinationsModel,
    messages,
    temperature: temperature || 0.7,
    stream: true,
    private: true,
  });

  const options = {
    hostname: "text.pollinations.ai",
    port: 443,
    path: "/openai",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Accept": "text/event-stream",
    },
  };

  const req = https.request(options, (apiRes) => {
    // If POST fails, fall back to GET (plain text, non-streamed)
    if (apiRes.statusCode && apiRes.statusCode >= 400) {
      const lastUser = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";
      const sysMsg   = messages.find(m => m.role === "system")?.content || "";
      const combined = sysMsg ? `${sysMsg}\n\nUser: ${lastUser}` : lastUser;
      const prompt   = encodeURIComponent(combined.slice(0, 2000));
      const getPath  = `/openai?model=openai-large&private=true`;
      const getBody  = JSON.stringify({ model: "openai-large", messages, stream: false, private: true });
      const getReq   = https.request(
        { hostname: "text.pollinations.ai", port: 443, path: getPath, method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(getBody) } },
        (gr) => {
          let txt = "";
          gr.on("data", d => { txt += d.toString(); });
          gr.on("end", () => {
            try {
              const parsed = JSON.parse(txt);
              const content = parsed?.choices?.[0]?.message?.content || parsed?.content || txt;
              onChunk(content);
            } catch { onChunk(txt); }
            onDone();
          });
          gr.on("error", onError);
        }
      );
      getReq.on("error", onError);
      getReq.write(getBody);
      getReq.end();
      return;
    }

    let lineBuffer = "";
    apiRes.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const raw = trimmed.slice(6);
        if (raw === "[DONE]") { onDone(); return; }
        try {
          const parsed = JSON.parse(raw);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content) onChunk(content);
        } catch { /* skip malformed */ }
      }
    });
    apiRes.on("end", onDone);
    apiRes.on("error", onError);
  });

  req.on("error", onError);
  req.setTimeout(60000, () => { req.destroy(); onError(new Error("Pollinations timeout")); });
  req.write(body);
  req.end();
}


async function chat(req, res) {
  const startedAt = Date.now();
  const reqId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const model = normalizeModel(req.body?.model);
  const safeMode = String(req.body?.safeMode || "false") === "true";
  const temperature = Number(req.body?.temperature ?? config.groqTemperature);
  const rawMax = Number(req.body?.maxTokens ?? config.groqMaxTokens);
  const maxTokens = Math.min(rawMax, 4096);
  const input = sanitizePrompt(req.body?.input || "", safeMode);
  const messages = normalizeMessages(req.body?.messages, input);
  const attachmentContext = getAttachmentContext(req.file);
  if (attachmentContext) messages.push({ role: "user", content: attachmentContext });

  if (!messages.length) throw new ApiError(400, "No valid messages provided");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const heartbeat = setInterval(() => { res.write(": ping\n\n"); }, 12000);

  logger.info("chat.request.started", {
    reqId, userId: req.user?.id || "anon", model,
    messages: messages.length, hasAttachment: Boolean(req.file),
    provider: groq ? "Groq" : "Pollinations",
  });

  const cleanup = () => { clearInterval(heartbeat); };

  // ── Use Groq if API key is available ─────────────────────────────────────────
  if (groq) {
    try {
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
      logger.info("chat.request.completed", { reqId, model, streamChunks: tokenCount, latencyMs: Date.now() - startedAt });
    } catch (err) {
      cleanup();
      logger.error("chat.request.failed", { reqId, model, message: err.message });
      sseWrite(res, { content: "\n\n⚠️ AI service temporarily unavailable. Please try again." });
      res.write("data: [DONE]\n\n");
      res.end();
    }
    return;
  }

  // ── Fallback: Pollinations.ai (free, no key required) ────────────────────────
  logger.info("chat.using_pollinations", { reqId, note: "No GROQ_API_KEY, using free Pollinations.ai" });

  streamFromPollinations(
    messages, model, temperature, res,
    (content) => { sseWrite(res, { content }); },
    () => {
      res.write("data: [DONE]\n\n");
      res.end();
      cleanup();
      logger.info("chat.pollinations.completed", { reqId, latencyMs: Date.now() - startedAt });
    },
    (err) => {
      cleanup();
      logger.error("chat.pollinations.failed", { reqId, message: err.message });
      sseWrite(res, { content: "\n\n⚠️ Unable to reach AI service. Please check your internet connection and try again." });
      res.write("data: [DONE]\n\n");
      res.end();
    }
  );
}

async function generateTitle(req, res) {
  const firstMessage = String(req.body?.firstMessage || "").trim();
  if (!firstMessage) throw new ApiError(400, "firstMessage is required");

  // Use Pollinations if Groq not available
  if (!groq) {
    const words = firstMessage.slice(0, 60).split(/\s+/).slice(0, 6).join(" ");
    return successResponse(res, "Title generated", { title: words + "…" });
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
  return successResponse(res, "Title generated", { title: title.replace(/^["']|["']$/g, "").slice(0, 64) });
}

async function followUps(req, res) {
  const lastMessage = String(req.body?.lastMessage || "").trim();
  const userQuery = String(req.body?.userQuery || "").trim();
  if (!lastMessage) throw new ApiError(400, "lastMessage is required");

  // Quick client-side suggestions if no Groq
  if (!groq) {
    const fallbacks = [
      "Can you explain this in simpler terms?",
      "What are the practical applications?",
      "Give me an example of this",
      "What should I learn next?",
    ];
    return successResponse(res, "Follow-ups generated", { suggestions: fallbacks });
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
