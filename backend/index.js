require("dotenv").config();

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const express  = require("express");
const cors     = require("cors");
const multer   = require("multer");
const pdfParse = require("pdf-parse");
const { Mistral } = require("@mistralai/mistralai");
const { signup, login, authMiddleware } = require("./auth");

const app  = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (/\.(onrender\.com|vercel\.app|netlify\.app|github\.io|railway\.app)$/.test(origin)) return cb(null, true);
    cb(null, true); // allow all for now — restrict in production
  },
  credentials: true,
}));

app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));

app.get("/",       (_req, res) => res.json({ status: "ok", service: "VetroAI Backend", version: "2.3" }));
app.get("/health", (_req, res) => res.json({ status: "healthy", uptime: process.uptime(), memory: process.memoryUsage() }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "application/pdf",
      "text/plain", "text/csv", "text/javascript", "text/typescript",
      "application/json",
    ];
    // also allow by extension for text files browsers mis-type
    const ext = file.originalname?.split(".").pop()?.toLowerCase();
    const textExts = ["txt","csv","js","ts","jsx","tsx","py","java","cpp","c","cs","go","rs","rb","php","swift","kt","md","json","yaml","yml","env","sh","sql"];
    if (allowed.includes(file.mimetype) || textExts.includes(ext)) return cb(null, true);
    cb(null, false);
  },
});

const mistral        = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ─── SYSTEM PROMPTS PER MODE ───────────────────────────────────────────────────
const MODE_PROMPTS = {
  vtu_academic: `You are VetroAI Academic Assistant. You are an expert tutor for university students, especially VTU (Visvesvaraya Technological University) students. 
- Explain concepts clearly with examples
- Use proper formatting with headers and sections
- For code questions, provide complete, well-commented implementations
- Support all subjects: DSA, DBMS, OS, CN, Software Engineering, ML, etc.
- When writing code, ALWAYS write the COMPLETE code — never truncate or summarize
- For long programs, write every single line — do not say "rest of the code..."`,

  debugger: `You are an expert software debugger and code reviewer.
- Analyze code systematically and identify all issues
- Provide the COMPLETE fixed code — never truncate
- Explain each bug and why it causes the problem
- Suggest performance improvements and best practices
- Support all programming languages
- For large codebases, write out the full corrected file`,

  astrology: `You are an expert Vedic astrologer with deep knowledge of Jyotish Shastra.
- Provide detailed astrological insights based on birth charts, planetary positions, and transits
- Explain with warmth, clarity and cultural sensitivity
- Cover all aspects: career, relationships, health, and spirituality`,

  fast_chat: `You are VetroAI. Be concise, direct, and helpful. Answer quickly without unnecessary preamble.`,

  creative: `You are a creative writing expert and storyteller.
- Be vivid, imaginative, and emotionally resonant
- For creative writing tasks, produce the FULL piece — never truncate
- Craft compelling narratives, dialogues, and descriptions
- Match the tone and style requested by the user`,

  analyst: `You are a senior data analyst and strategic business advisor.
- Provide data-driven insights with clear reasoning
- Use structured formats: tables, bullet points, numbered lists
- Give actionable recommendations
- Cover: market analysis, financial modeling, business strategy, statistics`,

  web_search: `You are VetroAI in Web Search Mode. 
- Always cite your sources using the URLs provided
- Prioritize recency — prefer newer information
- When search results conflict, acknowledge both sides
- Format: lead with the direct answer, then supporting details`,

  youtube: `You are VetroAI YouTube Notes Generator.
- Create comprehensive, well-structured notes from video transcripts
- Use clear headings, bullet points, and numbered lists
- Include ALL key concepts — do not skip any important detail
- Add a "Quick Summary" at the top and "Key Takeaways" at the bottom`,

  translator: `You are a professional multilingual translator and language expert.
- Detect the source language automatically
- Provide accurate translations with natural phrasing
- For ambiguous text, offer multiple translation options
- Explain cultural nuances and idiomatic expressions when relevant
- Support all major languages including Indian regional languages`,

  interviewer: `You are a senior technical interviewer from a top tech company (Google/Amazon/Microsoft level).
- Ask challenging, relevant interview questions
- Evaluate answers thoroughly and provide detailed feedback
- Cover: DSA, System Design, OOP, Databases, OS, Networking, Behavioral
- Give hints if the user is stuck, but guide rather than give away answers
- Rate answers on a scale of 1-10 with specific improvement suggestions`,

  code_writer: `You are an expert full-stack software engineer.
- Write COMPLETE, production-ready code — never truncate or abbreviate
- Include ALL imports, dependencies, error handling, and edge cases
- Add clear comments explaining complex logic
- Follow best practices and design patterns
- For long files (1000+ lines), write EVERY SINGLE LINE — never say "continue from here" or "rest is same"
- Always provide working, copy-paste ready solutions`,

  resume: `You are a professional resume writer and career coach.
- Create ATS-optimized resumes with strong action verbs
- Tailor content to specific job descriptions
- Provide honest feedback on weak points
- Suggest improvements for LinkedIn profiles too`,
};

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────
const rateLimits = new Map();
function rateLimit(key, maxPerMinute = 30) {
  const now  = Date.now();
  const data = rateLimits.get(key) || { count: 0, reset: now + 60_000 };
  if (now > data.reset) { data.count = 0; data.reset = now + 60_000; }
  data.count++;
  rateLimits.set(key, data);
  return data.count <= maxPerMinute;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) if (now > v.reset) rateLimits.delete(k);
}, 5 * 60_000);

// ─── REQUEST QUEUE ─────────────────────────────────────────────────────────────
class RequestQueue {
  constructor() { this.queue = []; this.processing = false; this.lastRequestTime = 0; this.minDelay = 300; }

  async add(fn, priority = false) {
    return new Promise((resolve, reject) => {
      if (priority) this.queue.unshift({ fn, resolve, reject });
      else this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const wait = this.minDelay - (Date.now() - this.lastRequestTime);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const { fn, resolve, reject } = this.queue.shift();
    this.lastRequestTime = Date.now();
    try { resolve(await fn()); } catch (err) { reject(err); }
    this.processing = false;
    setTimeout(() => this.process(), 0);
  }
}
const mistralQueue = new RequestQueue();

// ─── RETRY WITH EXPONENTIAL BACKOFF ───────────────────────────────────────────
async function withRetry(fn, maxRetries = 3, onRetry = null) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      lastError = err;
      const isRateLimit   = err?.statusCode === 429 || err?.message?.includes("429") || err?.message?.includes("rate");
      const isServerError = err?.statusCode >= 500;
      if (!isRateLimit && !isServerError) throw err;
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i + 1) * 1000 + Math.random() * 500;
        if (onRetry) onRetry(i + 1, delay, isRateLimit);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ─── GOOGLE SEARCH ────────────────────────────────────────────────────────────
async function searchGoogle(query) {
  if (!SERPER_API_KEY) return "";
  try {
    const res  = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 8 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const data  = await res.json();
    const parts = [];
    if (data.answerBox) {
      const ab  = data.answerBox;
      const ans = ab.answer || ab.snippet || ab.snippetHighlighted?.join(" ") || "";
      if (ans) parts.push(`ANSWER BOX: ${ans}${ab.link ? ` (${ab.link})` : ""}`);
    }
    if (data.knowledgeGraph?.description) parts.push(`KNOWLEDGE: ${data.knowledgeGraph.title} — ${data.knowledgeGraph.description}`);
    if (data.sportsResults?.games?.length) {
      parts.push(`SPORTS: ${data.sportsResults.games.slice(0, 4).map(g => `${g.homeTeam} ${g.homeScore ?? ""} vs ${g.awayTeam} ${g.awayScore ?? ""} (${g.status || g.date || ""})`).join(" | ")}`);
    }
    if (data.topStories?.length) {
      parts.push(`TOP NEWS:\n${data.topStories.slice(0, 4).map(s => `• ${s.title} (${s.source}, ${s.date || ""})`).join("\n")}`);
    }
    if (data.organic?.length) {
      parts.push(`WEB RESULTS:\n${data.organic.slice(0, 6).map((r, i) => `SOURCE ${i + 1}: ${r.title}\nSNIPPET: ${r.snippet || ""}\nURL: ${r.link || ""}`).join("\n\n")}`);
    }
    return parts.join("\n\n");
  } catch (err) { console.error("Search error:", err.message); return ""; }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post("/signup", signup);
app.post("/login",  login);

// ─── GENERATE TITLE ───────────────────────────────────────────────────────────
app.post("/generate-title", authMiddleware, async (req, res) => {
  const { firstMessage } = req.body;
  if (!firstMessage) return res.json({ title: "New Chat" });
  if (!rateLimit(`title:${req.user.email}`, 30)) return res.json({ title: firstMessage.slice(0, 32) });

  try {
    const response = await withRetry(
      () => mistralQueue.add(() => mistral.chat.complete({
        model: "mistral-small-latest",
        messages: [{ role: "user", content: `Create a very short chat title (3-5 words max, no quotes) summarizing: "${firstMessage.slice(0, 200)}"` }],
        maxTokens: 20,
      })), 3
    );
    const title = response.choices[0].message.content.trim().replace(/^["']|["']$/g, "");
    res.json({ title: title || firstMessage.slice(0, 32) });
  } catch (err) {
    console.error("Title error:", err.message);
    res.json({ title: firstMessage.slice(0, 32) + "…" });
  }
});

// ─── FOLLOW-UPS ───────────────────────────────────────────────────────────────
app.post("/follow-ups", authMiddleware, async (req, res) => {
  const { lastMessage, userQuery } = req.body;
  if (!lastMessage) return res.json({ suggestions: [] });
  if (!rateLimit(`followups:${req.user.email}`, 60)) return res.json({ suggestions: [] });

  try {
    const response = await withRetry(
      () => mistralQueue.add(() => mistral.chat.complete({
        model: "mistral-small-latest",
        messages: [{
          role: "user",
          content: `Based on this AI response: "${lastMessage.slice(0, 400)}"
Return ONLY a JSON array of exactly 3 short follow-up questions (under 60 chars each).
Format: ["Question 1?", "Question 2?", "Question 3?"]
No other text, no markdown, just the JSON array.`,
        }],
        maxTokens: 150,
      })), 3
    );
    const text  = response.choices[0].message.content.trim();
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return res.json({ suggestions: [] });
    const parsed = JSON.parse(match[0]);
    res.json({ suggestions: parsed.slice(0, 3).map(s => String(s)) });
  } catch (err) {
    console.error("Follow-ups error:", err.message);
    res.json({ suggestions: [] });
  }
});

// ─── MAIN CHAT ────────────────────────────────────────────────────────────────
app.post("/chat", authMiddleware, upload.single("file"), async (req, res) => {
  if (!rateLimit(`chat:${req.user.email}`, 80)) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ content: "⚠️ Rate limit reached. Please wait a moment and try again." })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  let streamStarted = false;
  let retryCount    = 0;
  const maxRetries  = 3;

  const attemptChat = async () => {
    try {
      let messages     = req.body.messages ? JSON.parse(req.body.messages) : [];
      let userPrompt   = (req.body.input || "").trim();
      const selectedMode = req.body.model || "vtu_academic";
      const file       = req.file;

      // Sanitize messages
      messages = messages
        .filter(m => ["user", "assistant", "system"].includes(m.role) && (typeof m.content === "string" || Array.isArray(m.content)))
        .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content.slice(0, 12000) : m.content }));

      // ── File handling ──
      if (file) {
        if (file.mimetype.startsWith("image/")) {
          const base64Img = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
          messages.push({
            role: "user",
            content: [
              { type: "text", text: userPrompt || "Describe this image in detail." },
              { type: "image_url", image_url: { url: base64Img } },
            ],
          });
          userPrompt = "";
        } else if (file.mimetype === "application/pdf") {
          try {
            const data      = await pdfParse(file.buffer);
            const extracted = data.text.slice(0, 12000);
            userPrompt = userPrompt
              ? `${userPrompt}\n\n[PDF: ${file.originalname}]\n${extracted}`
              : `Analyse and summarise this PDF (${file.originalname}):\n\n${extracted}`;
          } catch { userPrompt += "\n\n[PDF could not be parsed — please try a different file]"; }
        } else {
          // Text-based file
          try {
            const text = file.buffer.toString("utf-8").slice(0, 12000);
            userPrompt = userPrompt
              ? `${userPrompt}\n\n[File: ${file.originalname}]\n\`\`\`\n${text}\n\`\`\``
              : `Here is the file (${file.originalname}):\n\`\`\`\n${text}\n\`\`\`\nPlease analyse this code/file and help me with it.`;
          } catch { userPrompt += `\n\n[Could not read file: ${file.originalname}]`; }
        }
      }

      // ── Build system prompt ──
      const modeSystemPrompt = MODE_PROMPTS[selectedMode] || MODE_PROMPTS.vtu_academic;

      // ── Detect if this is a code-heavy request ──
      const isCodeRequest = /\b(write|create|build|make|implement|generate|code|program|script|function|class|component|app|application|api|server|full|complete|entire|whole)\b/i.test(userPrompt);
      const maxToks = isCodeRequest ? 8192 : 4096;

      // ── Inject system prompt if not present ──
      if (!messages.find(m => m.role === "system")) {
        messages.unshift({ role: "system", content: modeSystemPrompt });
      }

      // ── Add user message ──
      if (userPrompt) messages.push({ role: "user", content: userPrompt });

      // ── Trim context window (keep system + last 24 messages) ──
      const systemMsgs = messages.filter(m => m.role === "system");
      const nonSystem  = messages.filter(m => m.role !== "system").slice(-24);
      messages = [...systemMsgs, ...nonSystem];

      // ── Start SSE ──
      if (!streamStarted) {
        res.setHeader("Content-Type",     "text/event-stream");
        res.setHeader("Cache-Control",    "no-cache");
        res.setHeader("Connection",       "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Transfer-Encoding", "chunked");
        streamStarted = true;
      }

      const hasImage   = messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image_url"));
      const modelToUse = hasImage ? "pixtral-12b-2409" : "mistral-large-latest";

      const stream = await withRetry(
        () => mistralQueue.add(() => mistral.chat.stream({
          model:     modelToUse,
          messages,
          maxTokens: maxToks,
          temperature: selectedMode === "creative" ? 0.85 : selectedMode === "fast_chat" ? 0.3 : 0.7,
        })),
        maxRetries,
        (attempt, delay, isRateLimit) => {
          retryCount = attempt;
          if (streamStarted) {
            res.write(`data: ${JSON.stringify({ content: `\n\n⏳ ${isRateLimit ? "Rate limited" : "Server error"}, retrying (${attempt}/${maxRetries})...\n\n` })}\n\n`);
          }
        }
      );

      let charsSent  = 0;
      const MAX_OUT  = 64_000; // ~16,000 tokens worth of chars — enough for 1000+ line programs

      for await (const chunk of stream) {
        if (charsSent >= MAX_OUT) {
          res.write(`data: ${JSON.stringify({ content: "\n\n---\n*[Output limit reached — ask me to continue if needed]*" })}\n\n`);
          break;
        }
        const content = chunk.data.choices[0]?.delta?.content || "";
        if (content) {
          charsSent += content.length;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();

    } catch (err) {
      const isRateLimit   = err?.statusCode === 429 || err?.message?.includes("429") || err?.message?.includes("rate");
      const isServerError = err?.statusCode >= 500;

      if ((isRateLimit || isServerError) && retryCount < maxRetries - 1) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
        if (!streamStarted) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection",    "keep-alive");
          streamStarted = true;
        }
        res.write(`data: ${JSON.stringify({ content: `⏳ Rate limited. Retrying in ${Math.round(delay / 1000)}s... (${retryCount}/${maxRetries})\n\n` })}\n\n`);
        await new Promise(r => setTimeout(r, delay));
        return attemptChat();
      }
      throw err;
    }
  };

  try {
    await attemptChat();
  } catch (err) {
    console.error("Chat error (final):", err.message || err);
    if (!streamStarted) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection",    "keep-alive");
    }
    const isRateLimit = err?.statusCode === 429 || err?.message?.includes("429");
    const msg = isRateLimit
      ? "⚠️ AI rate limit reached. Please wait 30 seconds and try again."
      : `⚠️ Error: ${err.message || "Server error. Please try again."}`;
    res.write(`data: ${JSON.stringify({ content: msg })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

// ─── 404 & ERROR HANDLERS ─────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => console.log(`🚀 VetroAI Backend v2.3 on port ${PORT} (${process.env.NODE_ENV || "development"})`));