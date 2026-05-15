const express = require("express");
const router = express.Router();
const providerManager = require("../services/ProviderManager");
const logger = require("../utils/logger");

router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    providers: providerManager.getStats()
  });
});

router.get("/test/:provider", async (req, res) => {
  const { provider } = req.params;
  const adapter = providerManager.getAdapter(provider);
  
  if (!adapter) {
    return res.status(404).json({ error: "Provider adapter not found", available: Object.keys(providerManager.adapters) });
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
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
