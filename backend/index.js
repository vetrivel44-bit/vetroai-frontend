require("dotenv").config();

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { Mistral } = require("@mistralai/mistralai");
const { signup, login, googleAuth, authMiddleware } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ── Google search helper ───────────────────────────────────────────────────
async function searchGoogle(query) {
  if (!SERPER_API_KEY) return "";
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 8 }),
    });
    const data = await response.json();
    const parts = [];

    if (data.answerBox) {
      const ab = data.answerBox;
      const ans = ab.answer || ab.snippet || (ab.snippetHighlighted?.join(" ")) || "";
      if (ans) parts.push(`ANSWER BOX: ${ans}${ab.link ? ` (${ab.link})` : ""}`);
    }
    if (data.knowledgeGraph?.description) {
      parts.push(`KNOWLEDGE: ${data.knowledgeGraph.title} — ${data.knowledgeGraph.description}`);
    }
    if (data.sportsResults?.games?.length) {
      const games = data.sportsResults.games.slice(0, 4).map(g =>
        `${g.homeTeam} ${g.homeScore ?? ""} vs ${g.awayTeam} ${g.awayScore ?? ""} (${g.status || g.date || ""})`
      ).join(" | ");
      parts.push(`SPORTS: ${games}`);
    }
    if (data.topStories?.length) {
      const stories = data.topStories.slice(0, 4).map(s => `• ${s.title} (${s.source}, ${s.date || ""})`).join("\n");
      parts.push(`TOP NEWS:\n${stories}`);
    }
    if (data.organic?.length) {
      const organic = data.organic.slice(0, 6).map((r, i) =>
        `SOURCE ${i + 1}: ${r.title}\nSNIPPET: ${r.snippet || ""}\nURL: ${r.link || ""}`
      ).join("\n\n");
      parts.push(`WEB RESULTS:\n${organic}`);
    }
    return parts.join("\n\n");
  } catch (err) {
    console.error("Search error:", err.message);
    return "";
  }
}

// ── Auth routes ────────────────────────────────────────────────────────────
app.post("/signup", signup);
app.post("/login", login);
app.post("/auth/google", googleAuth);

// ── Generate chat title ────────────────────────────────────────────────────
app.post("/generate-title", authMiddleware, async (req, res) => {
  const { firstMessage } = req.body;
  if (!firstMessage) return res.json({ title: "New Chat" });

  try {
    const response = await mistral.chat.complete({
      model: "mistral-small-latest",
      messages: [{
        role: "user",
        content: `Create a very short chat title (3-5 words max, no quotes) summarizing this message: "${firstMessage.slice(0, 200)}"`
      }],
      maxTokens: 15,
    });
    const title = response.choices[0].message.content.trim().replace(/^["']|["']$/g, "");
    res.json({ title: title || firstMessage.slice(0, 32) });
  } catch {
    res.json({ title: firstMessage.slice(0, 32) + "…" });
  }
});

// ── Generate follow-up suggestions ────────────────────────────────────────
app.post("/follow-ups", authMiddleware, async (req, res) => {
  const { lastMessage, userQuery } = req.body;
  if (!lastMessage) return res.json({ suggestions: [] });

  try {
    const response = await mistral.chat.complete({
      model: "mistral-small-latest",
      messages: [{
        role: "user",
        content: `Given this AI response: "${lastMessage.slice(0, 500)}"

Return ONLY a JSON array of exactly 3 short follow-up questions (under 55 chars each) the user might want to ask next.
Format: ["Question 1?", "Question 2?", "Question 3?"]
No other text, just the JSON array.`
      }],
      maxTokens: 120,
    });

    const text = response.choices[0].message.content.trim();
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return res.json({ suggestions: [] });

    const parsed = JSON.parse(match[0]);
    res.json({ suggestions: parsed.slice(0, 3).map(s => String(s)) });
  } catch (err) {
    console.error("Follow-ups error:", err.message);
    res.json({ suggestions: [] });
  }
});

// ── Main chat route ────────────────────────────────────────────────────────
app.post("/chat", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    let messages = req.body.messages ? JSON.parse(req.body.messages) : [];
    let userPrompt = req.body.input || "";
    const selectedMode = req.body.model || "vtu_academic";
    const file = req.file;

    // Handle image upload
    if (file && file.mimetype.startsWith("image/")) {
      const base64Img = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userPrompt || "Describe this image." },
          { type: "image_url", image_url: { url: base64Img } },
        ],
      });
      userPrompt = "";
    }

    // Handle PDF upload
    if (file && file.mimetype === "application/pdf") {
      const data = await pdfParse(file.buffer);
      userPrompt += "\n\nPDF Content:\n" + data.text.slice(0, 8000);
    }

    // Build system prompt if not already set
    let defaultSystem = "You are VetroAI, a helpful and intelligent AI assistant.";
    if (selectedMode === "astrology") defaultSystem = "You are an expert Vedic astrologer. Provide detailed astrological insights with warmth and accuracy.";
    else if (selectedMode === "debugger") defaultSystem = "You are an expert software debugger. Analyze code systematically, identify root causes, and provide precise fixes.";
    else if (selectedMode === "analyst") defaultSystem = "You are a data analyst and strategic advisor. Provide data-driven insights and actionable recommendations.";
    else if (selectedMode === "creative") defaultSystem = "You are a creative writing expert. Be vivid, imaginative, and emotionally resonant.";

    // Inject default system only if not already present with a system message
    if (!messages.find(m => m.role === "system")) {
      messages.unshift({ role: "system", content: defaultSystem });
    }

    if (userPrompt) messages.push({ role: "user", content: userPrompt });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await mistral.chat.stream({
      model: "pixtral-12b-2409",
      messages,
      maxTokens: 2048,
    });

    for await (const chunk of stream) {
      const content = chunk.data.choices[0]?.delta?.content || "";
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    res.write(`data: ${JSON.stringify({ content: "⚠️ Server error. Please try again." })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

app.listen(PORT, () => console.log(`🚀 VetroAI Backend running on port ${PORT}`));