const express = require("express");
const router = express.Router();
const providerManager = require("../services/ProviderManager");
const crypto = require("crypto");
const logger = require("../utils/logger");

// Provider tests spend real credits, so they only answer a caller holding
// DEBUG_TOKEN (as ?token= or an x-debug-token header). Unset = disabled.
function hasDebugToken(req) {
  const expected = String(process.env.DEBUG_TOKEN || "");
  const given = String(req.get("x-debug-token") || req.query.token || "");
  if (!expected || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function requireDebugToken(req, res, next) {
  if (!hasDebugToken(req)) return res.status(404).json({ error: "Not found" });
  next();
}

router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    providers: providerManager.getStats()
  });
});

router.get("/test/:provider", requireDebugToken, async (req, res) => {
  const { provider } = req.params;
  const adapter = providerManager.getAdapter(provider);
  
  if (!adapter) {
    return res.status(404).json({ error: "Provider adapter not found", available: Object.keys(providerManager.providers) });
  }

  logger.info("Debug.test.start", { provider });
  
  try {
    const stream = await adapter.generateStream(
      [{ role: "user", content: "Say 'Test Successful' in 3 words." }],
      { temperature: 0.1, maxTokens: 10 }
    );
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (typeof stream[Symbol.asyncIterator] === "function") {
      for await (const chunk of stream) {
        const content = chunk?.choices?.[0]?.delta?.content || "";
        if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    } else if (stream.getReader) {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
    }
    
    res.write("data: [DONE]\n\n");
    res.end();
    logger.info("Debug.test.completed", { provider });
  } catch (err) {
    logger.error("Debug.test.failed", { provider, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
