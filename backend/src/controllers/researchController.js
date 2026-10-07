const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const AIOrchestrator = require("../services/AIOrchestrator");
const { performAgenticSearch } = require("../services/agenticSearchService");
const { clientClock } = require("../services/clockService");
const { withTimeout } = require("../utils/withTimeout");

// POST /api/research { query, messages?, clientTimeZone? } — server-sent events.
//
// DeepSearch for browser models. They can't search, so the browser asks for
// the same research the backend's own models get (plan, search, read, fill
// gaps, cross-check), streamed as the same activity log, and then has the
// chosen model write the report from it. Events:
//   status   one-line progress
//   research the activity log snapshot (see agenticSearchService.js)
//   sources  the numbered sources, in citation order
//   research_result { context, instructions } for the writing model
//   error
async function research(req, res) {
  const query = String(req.body?.query || "").trim().slice(0, 2000);
  if (!query) throw new ApiError(400, "query is required");

  const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // The request body has been read by now, so req's "close" has already
  // fired; the response's "close" before it ends is the reader leaving. Then
  // the research stops instead of spending searches nobody will read.
  let closed = false;
  const cancel = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) { closed = true; cancel.abort(); }
  });
  const send = (type, data) => { if (!closed) res.write(`data: ${JSON.stringify({ type, data })}\n\n`); };
  const heartbeat = setInterval(() => { if (!closed) res.write(": ping\n\n"); }, 12000);

  try {
    const result = await withTimeout(
      performAgenticSearch(query, {
        clock: clientClock(req.body),
        history: AIOrchestrator.recentHistory([...messages, { role: "user", content: query }]),
        deadlineMs: AIOrchestrator.RESEARCH_DEADLINE_MS,
        signal: cancel.signal,
        onStatus: (msg) => send("status", msg),
        onProgress: (snapshot) => send("research", snapshot),
      }),
      AIOrchestrator.RESEARCH_DEADLINE_MS + 20000,
      "Research timed out",
    );
    send("sources", AIOrchestrator.normalizeSources(result.results, 40));
    send("research_result", { context: result.context, instructions: AIOrchestrator.RESEARCH_REPORT_PROMPT });
    if (closed) logger.info("research.endpoint.cancelled", { sources: result.results.length });
  } catch (err) {
    logger.error("research.endpoint.failed", { error: err.message });
    send("error", `Research failed: ${err.message}`);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

module.exports = { research };
