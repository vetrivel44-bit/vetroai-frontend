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

function normalizePluginIds(rawPlugins) {
  let parsed = rawPlugins;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); }
    catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed
    .filter((id) => typeof id === "string")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => Object.hasOwn(PLUGIN_CATALOG, id)))]
    .slice(0, 8);
}

function buildPluginPrompt(pluginIds) {
  const normalized = normalizePluginIds(pluginIds);
  if (normalized.length === 0) return "";
  const capabilities = normalized.map((id) => {
    const plugin = PLUGIN_CATALOG[id];
    return `- ${plugin.name}: ${plugin.instruction}`;
  });
  return `\n\n[ACTIVE VETROAI PLUGINS]\nThe user enabled these plugins for this request. Use them only when relevant:\n${capabilities.join("\n")}`;
}

module.exports = { PLUGIN_CATALOG, normalizePluginIds, buildPluginPrompt };

