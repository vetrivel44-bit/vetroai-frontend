const ApiError = require("../utils/apiError");
const { buildAstrologyContext } = require("../services/astrologyContext");

// POST /api/astrology/context { messages: [{ role, content }] }
// Browser models can't reach ProKerala themselves, so the frontend asks for
// the same grounding the backend gives its own models: a system-prompt
// addition (live data, "ask for birth details", or "service unavailable") and
// the rasi chart block to show above the answer.
async function astrologyContext(req, res, next) {
  try {
    const raw = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!raw) throw new ApiError(400, "messages must be an array");
    const messages = raw
      .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    const userQuery = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const result = await buildAstrologyContext(messages, userQuery);
    return res.json({ astrology: result.status !== "none", ...result });
  } catch (error) {
    return next(error);
  }
}

module.exports = { astrologyContext };
