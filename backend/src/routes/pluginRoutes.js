const express = require("express");
const { chatLimiter } = require("../middleware/rateLimiters");
const pluginLive = require("../services/pluginLiveService");

const router = express.Router();

// Live sources only: reading an arbitrary page happens inside a chat, not
// through this public route.
const KINDS = new Set(Object.values(pluginLive.LIVE_KIND_BY_PLUGIN).filter((kind) => kind !== "page"));

// Which live-data connectors have their keys set (true/false only, never a
// value), for the Plugins page's connector list.
router.get("/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ connectors: pluginLive.connectorStatus() });
});

// One live source for a query: /api/plugins/live/weather?q=weather in Chennai.
// The same data the model gets in a chat (services/pluginLiveService.js).
router.get("/live/:kind", chatLimiter, async (req, res, next) => {
  try {
    const kind = String(req.params.kind || "");
    if (!KINDS.has(kind)) return res.status(404).json({ error: "Unknown live source." });
    const query = String(req.query.q || "").slice(0, 200);
    const timezone = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(String(req.query.tz || "")) ? String(req.query.tz) : "";
    const result = await pluginLive.fetchLive(kind, query, { timezone });
    res.set("Cache-Control", "no-store");
    if (result.connected === false) return res.json({ kind, connected: false, notice: result.notice, envVar: result.envVar });
    if (result.error) return res.status(502).json({ kind, connected: true, error: result.error });
    return res.json({ kind, connected: true, source: result.source, fetchedAt: result.fetchedAt, lines: result.lines });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
