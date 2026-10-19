// Usage limits, the way Claude's work: a session window that starts with your
// first message and resets 5 hours later, and a weekly window that resets 7
// days after it starts. Heavier models use more of each limit per message,
// and the heaviest also share their own weekly cap.
//
// Limits are in "units": a message costs its model's weight (below). Tune
// the numbers here; the app and the Settings → Usage page read them from the
// server, so nothing else needs to change.

const HOUR = 60 * 60 * 1000;
const SESSION_MS = 5 * HOUR;
const WEEK_MS = 7 * 24 * HOUR;

// computerWeekly: VetroAI Computer runs (folder tools, research → files,
// website builds, screen control) per week. scheduledActive: scheduled tasks
// that can be running at once. Free accounts get a taste of each.
const PLAN_LIMITS = {
  free: { session: 40, weekly: 300, premiumWeekly: 40, computerWeekly: 3, scheduledActive: 1 },
  pro: { session: 400, weekly: 3000, premiumWeekly: 600, computerWeekly: 100, scheduledActive: 10 },
  team: { session: 600, weekly: 4500, premiumWeekly: 900, computerWeekly: 200, scheduledActive: 20 },
};

// The model name a Computer run is recorded under.
const COMPUTER_MODEL = "VetroAI Computer";

// First match wins. "premium" models also count towards premiumWeekly.
const MODEL_TIERS = [
  { tier: "premium", weight: 4, label: "Most capable", re: /\b(opus|gpt-5\.6 sol|fable 5\.1|claude fable 5\b(?!\.)|deepsearch|deep search|sonar|research)\b/i },
  { tier: "standard", weight: 2, label: "Balanced", re: /\b(sonnet|terra|codex|deepseek|grok|gemini 3\.1 pro|vercel|sarvam 105b)\b/i },
  { tier: "light", weight: 1, label: "Fast", re: /./ },
];

function tierFor(model) {
  return MODEL_TIERS.find((t) => t.re.test(String(model || ""))) || MODEL_TIERS[MODEL_TIERS.length - 1];
}

function limitsFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

module.exports = { SESSION_MS, WEEK_MS, PLAN_LIMITS, MODEL_TIERS, COMPUTER_MODEL, tierFor, limitsFor };
