const usage = require("../services/usageService");
const { MODEL_TIERS, SESSION_MS, WEEK_MS } = require("../config/usageLimits");

const modelOf = (value) => String(value || "Auto").trim().slice(0, 60) || "Auto";

const describe = (id, summary) => ({
  ...summary,
  signedIn: id.signedIn,
  storage: usage.persistence(),
  windows: { sessionMs: SESSION_MS, weekMs: WEEK_MS },
  tiers: MODEL_TIERS.map(({ tier, weight, label }) => ({ tier, weight, label })),
});

// GET /api/usage — the caller's usage, limits and reset times.
async function getUsage(req, res) {
  const id = usage.identityOf(req);
  const { summary } = await usage.check(id.key, id.plan, "Auto");
  res.json({ success: true, data: describe(id, summary) });
}

// POST /api/usage/consume { model } — a model that answers in the browser
// asks here before it starts, so its messages count and its limits hold.
async function consume(req, res) {
  const id = usage.identityOf(req);
  const model = modelOf(req.body?.model);
  const result = await usage.consume(id.key, id.plan, model);
  if (!result.allowed) {
    return res.status(429).json({
      success: false,
      code: "USAGE_LIMIT",
      message: usage.limitMessage(result.block, model),
      block: result.block,
      data: describe(id, result.summary),
    });
  }
  res.json({ success: true, data: describe(id, result.summary) });
}

module.exports = { getUsage, consume, modelOf };
