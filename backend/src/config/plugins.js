const PLUGIN_CATALOG = Object.freeze({
  "web-search": {
    name: "Web Search",
    instruction: "Use live web context when the question needs current information. Prefer cited, verifiable sources and never invent links.",
  },
  "data-analyst": {
    name: "Data Analyst",
    instruction: "Analyze data carefully. Prefer concise findings, exact comparisons, tables, metrics, and a suitable visualization when it improves understanding.",
  },
  "code-runner": {
    name: "Code Runner",
    instruction: "Act as a pragmatic software engineer. Provide correct, runnable code, explain important tradeoffs, and surface assumptions or unsafe operations.",
  },
  "image-studio": {
    name: "Image Studio",
    instruction: "Help create strong visual concepts and precise image prompts. Ask only for details that materially affect the result.",
  },
  maps: {
    name: "Maps",
    instruction: "For location requests, return specific useful places and clickable map links. Do not claim live availability unless it was fetched.",
  },
  jobs: {
    name: "Job Search",
    instruction: "For career requests, prioritize relevant roles, concrete application advice, resume improvements, and interview preparation.",
  },
  "sports-live": {
    name: "Live Sports",
    instruction: "Use available live sports context for scores and fixtures. Clearly distinguish live data from general knowledge.",
  },
  "study-coach": {
    name: "Study Coach",
    instruction: "Teach in simple terms and format exam answers for scoring: direct definition, key points, and a short example when useful.",
  },
});

// Every plugin id the app's catalog has (frontend src/plugins/catalog.js;
// test/plugins.test.js checks the two lists match). Anything else is dropped.
const KNOWN_PLUGIN_IDS = new Set([
  "web-search", "deep-report", "page-digest", "day-planner", "mail-drafter", "meeting-notes", "task-tracker",
  "code-runner", "code-review", "bug-hunter", "repo-helper", "sql-helper", "regex-lab", "doc-writer",
  "sheet-builder", "slide-maker", "pdf-tools", "data-analyst", "chart-maker", "csv-explorer", "sports-live",
  "weather-now", "news-brief", "markets", "currency-convert", "grammar-check", "translator", "tone-rewriter",
  "resume-builder", "study-coach", "flashcard-maker", "quiz-master", "explain-simply", "image-studio",
  "maps", "jobs", "sales-pack", "marketing-pack", "legal-pack", "finance-pack", "hr-pack",
]);

function parseJson(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizePluginIds(rawPlugins) {
  const parsed = parseJson(rawPlugins);
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed
    .filter((id) => typeof id === "string")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => KNOWN_PLUGIN_IDS.has(id)))]
    .slice(0, 8);
}

// Limits on what the app may add to the system prompt for its plugins. The
// text is the user's own choice of skills (like their custom instructions),
// but it is bounded so a message can't carry a huge prompt.
const MAX_SKILLS = 3;
const MAX_INSTRUCTIONS = 1200;
const MAX_TOTAL = 6000;
const clean = (text, max) => String(text || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+\n/g, "\n").trim().slice(0, max);

/**
 * The plugins' skills sent with a message ("pluginContext"), checked: only
 * plugins that are in `ids`, plain text, bounded in size.
 * → [{ id, name, skills: [{ name, instructions }] }]
 */
function normalizePluginContext(rawContext, ids = []) {
  const parsed = parseJson(rawContext);
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(ids);
  let total = 0;
  const out = [];
  for (const entry of parsed) {
    const id = String(entry?.id || "").trim().toLowerCase();
    if (!allowed.has(id) || out.some((p) => p.id === id)) continue;
    const skills = [];
    for (const skill of Array.isArray(entry.skills) ? entry.skills.slice(0, MAX_SKILLS) : []) {
      const instructions = clean(skill?.instructions, MAX_INSTRUCTIONS);
      if (!instructions || total + instructions.length > MAX_TOTAL) continue;
      total += instructions.length;
      skills.push({ name: clean(skill?.name, 60) || "Skill", instructions });
    }
    out.push({ id, name: clean(entry.name, 60) || PLUGIN_CATALOG[id]?.name || id, skills });
  }
  return out;
}

/**
 * The plugins section of the system prompt: each plugin's skills and their
 * instructions (from `context`), or for an older app that sends only ids,
 * the built-in instruction of a known plugin.
 */
function buildPluginPrompt(pluginIds, context = []) {
  const normalized = normalizePluginIds(pluginIds);
  if (normalized.length === 0) return "";
  const byId = new Map((context || []).map((p) => [p.id, p]));
  const sections = normalized.map((id) => {
    const plugin = byId.get(id);
    if (plugin?.skills?.length) {
      return `## ${plugin.name}\n${plugin.skills.map((s) => `- ${s.name}: ${s.instructions}`).join("\n")}`;
    }
    const builtIn = PLUGIN_CATALOG[id];
    return builtIn ? `## ${builtIn.name}\n- ${builtIn.instruction}` : "";
  }).filter(Boolean);
  if (!sections.length) return "";
  return `\n\n# ACTIVE PLUGINS\nThe user is using these VetroAI plugins for this message. Follow their skills where they apply; the rest of your instructions still hold.\n${sections.join("\n\n")}`;
}

module.exports = { PLUGIN_CATALOG, KNOWN_PLUGIN_IDS, normalizePluginIds, normalizePluginContext, buildPluginPrompt };
