require("dotenv").config();

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { Mistral } = require("@mistralai/mistralai");
const { signup, login, authMiddleware } = require("./auth");

const app = express();

/* ✅ FIXED PORT FOR RENDER */
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

const SERPER_API_KEY = process.env.SERPER_API_KEY;

async function searchGoogle(query) {
  if (!SERPER_API_KEY) return "";

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });

    const data = await response.json();
    if (!data.organic) return "";

    return data.organic
      .map(
        (r, i) =>
          `SOURCE ${i + 1}: ${r.title}\nDATE: ${
            r.date || "Current"
          }\nSNIPPET: ${r.snippet}`
      )
      .join("\n\n");
  } catch (err) {
    console.error("Search error:", err);
    return "";
  }
}

app.post("/signup", signup);
app.post("/login", login);

app.post("/chat", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    let messages = req.body.messages
      ? JSON.parse(req.body.messages)
      : [];

    let userPrompt = req.body.input || "";
    let selectedMode = req.body.model || "vtu_academic";
    const file = req.file;

    if (file && file.mimetype.startsWith("image/")) {
      const base64Img = `data:${file.mimetype};base64,${file.buffer.toString(
        "base64"
      )}`;

      messages.push({
        role: "user",
        content: [
          { type: "text", text: userPrompt || "Describe this image." },
          { type: "image_url", image_url: { url: base64Img } },
        ],
      });

      userPrompt = "";
    }

    if (file && file.mimetype === "application/pdf") {
      const data = await pdfParse(file.buffer);
      userPrompt += "\n\nPDF Content:\n" + data.text.slice(0, 8000);
    }

    let systemPrompt = "You are VetroAI.";

    if (selectedMode === "astrology") {
      systemPrompt = "You are an astrologer.";
    } else if (selectedMode === "debugger") {
      systemPrompt = "You are a strict debugger.";
    }

    if (messages.length === 0 || messages[0].role !== "system") {
      messages.unshift({ role: "system", content: systemPrompt });
    }

    if (userPrompt) {
      messages.push({ role: "user", content: userPrompt });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await mistral.chat.stream({
      model: "pixtral-12b-2409",
      messages,
      maxTokens: 1024,
    });

    for await (const chunk of stream) {
      const content = chunk.data.choices[0]?.delta?.content || "";

      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Chat error:", err);

    res.write(
      `data: ${JSON.stringify({ content: "⚠️ Server busy." })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 VetroAI Backend Running on Port ${PORT}`);
});