const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const usage = require("../services/usageService");
const { buildCourse } = require("../services/courseService");

// The usage model a course is counted as: one premium message for the whole
// course, however many chapters it takes (config/usageLimits.js).
const COURSE_MODEL = "VetroAI Course";

// POST /api/course { topic, provider?, modelLabel? } — server-sent events
// (see courseService.buildCourse for the event types). The reader leaving
// stops the writing.
async function course(req, res) {
  const topic = String(req.body?.topic || "").trim().slice(0, 500);
  if (!topic) throw new ApiError(400, "topic is required");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  const cancel = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) { closed = true; cancel.abort(); }
  });
  const send = (type, data, extra) => { if (!closed) res.write(`data: ${JSON.stringify({ type, data, ...(extra || {}) })}\n\n`); };

  const usageId = usage.identityOf(req);
  try {
    const gate = await usage.check(usageId.key, usageId.plan, COURSE_MODEL, Date.now(), usageId.cloud);
    if (!gate.allowed) {
      send("error", usage.limitMessage(gate.block, COURSE_MODEL), { code: "USAGE_LIMIT", usage: { ...gate.block, model: COURSE_MODEL } });
      return res.end();
    }
  } catch (err) {
    logger.warn("course.usageCheckFailed", { error: err.message }); // never block on a usage-store error
  }

  const heartbeat = setInterval(() => { if (!closed) res.write(": ping\n\n"); }, 12000);
  try {
    const written = await buildCourse(topic, {
      preferredProvider: String(req.body?.provider || ""),
      modelLabel: String(req.body?.modelLabel || req.body?.provider || ""),
      send,
      signal: cancel.signal,
    });
    // Counted only once there is a course to read.
    if (written > 0) {
      usage.record(usageId.key, usageId.plan, COURSE_MODEL, Date.now(), usageId.cloud)
        .catch((err) => logger.warn("course.usageRecordFailed", { error: err.message }));
    }
    logger.info("course.done", { written, cancelled: closed });
  } catch (err) {
    if (!closed) {
      logger.error("course.failed", { error: err.message });
      send("error", err.message || "The course couldn't be made. Please try again.");
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

module.exports = { course, COURSE_MODEL };
