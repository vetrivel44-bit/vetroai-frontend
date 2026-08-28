export const PLUGIN_STORAGE_KEY = "vetroai_plugins_v1";

export const PLUGIN_CATALOG = [
  {
    id: "web-search",
    name: "Web Search",
    tagline: "Fresh answers with live sources",
    description: "Search the live web when a question needs current information, links, or citations.",
    category: "Research",
    icon: "globe",
    color: "#2563eb",
    featured: true,
    permissions: ["Send search queries", "Read public webpages"],
    aliases: ["web", "search", "web search"],
    triggers: ["latest", "current", "today", "news", "weather", "price", "live", "source", "website"],
  },
  {
    id: "data-analyst",
    name: "Data Analyst",
    tagline: "Charts, comparisons, and insights",
    description: "Turn pasted or uploaded data into clear analysis, tables, metrics, and visualizations.",
    category: "Productivity",
    icon: "chart",
    color: "#7c3aed",
    featured: true,
    permissions: ["Read files you attach", "Create charts in chat"],
    aliases: ["analyst", "data", "data analyst"],
    triggers: ["analyze data", "analyse data", "dataset", "spreadsheet", "csv", "chart", "graph", "statistics"],
  },
  {
    id: "code-runner",
    name: "Code Runner",
    tagline: "Write, debug, and explain code",
    description: "Get implementation help, debugging guidance, and runnable code across popular languages.",
    category: "Developer",
    icon: "terminal",
    color: "#059669",
    featured: true,
    permissions: ["Read code you provide", "Use the code workspace"],
    aliases: ["code", "coder", "code runner"],
    triggers: ["code", "debug", "program", "function", "script", "error", "stack trace", "algorithm"],
  },
  {
    id: "image-studio",
    name: "Image Studio",
    tagline: "Create and refine visuals",
    description: "Plan image prompts, generate visual concepts, and help refine creative assets.",
    category: "Creative",
    icon: "image",
    color: "#db2777",
    featured: true,
    permissions: ["Use prompts you provide", "Create image requests"],
    aliases: ["image", "images", "image studio"],
    triggers: ["generate image", "create image", "make image", "draw", "illustration", "logo", "poster", "wallpaper"],
  },
  {
    id: "maps",
    name: "Maps",
    tagline: "Places, routes, and local results",
    description: "Find places and present useful locations, route guidance, and clickable map links.",
    category: "Travel",
    icon: "map",
    color: "#ea580c",
    permissions: ["Use locations you provide", "Read public place data"],
    aliases: ["map", "maps", "places"],
    triggers: ["near me", "nearby", "directions", "route", "location", "place", "restaurant", "hotel"],
  },
  {
    id: "jobs",
    name: "Job Search",
    tagline: "Discover roles and prepare to apply",
    description: "Search relevant roles and improve resumes, applications, and interview preparation.",
    category: "Career",
    icon: "briefcase",
    color: "#0891b2",
    permissions: ["Use career details you provide", "Read public job listings"],
    aliases: ["jobs", "job", "job search"],
    triggers: ["job", "vacancy", "career", "resume", "cv", "interview", "hiring"],
  },
  {
    id: "sports-live",
    name: "Live Sports",
    tagline: "Scores, fixtures, and match context",
    description: "Bring live cricket and football information into sports conversations.",
    category: "Lifestyle",
    icon: "trophy",
    color: "#ca8a04",
    permissions: ["Read public sports feeds"],
    aliases: ["sports", "scores", "live sports"],
    triggers: ["score", "match", "fixture", "standings", "cricket", "football", "ipl", "league"],
  },
  {
    id: "study-coach",
    name: "Study Coach",
    tagline: "Simple, exam-ready learning",
    description: "Explain concepts in simple terms, create revision plans, and format scoring-friendly answers.",
    category: "Education",
    icon: "study",
    color: "#4f46e5",
    permissions: ["Use study details you provide"],
    aliases: ["study", "teacher", "study coach"],
    triggers: ["explain", "solve", "exam", "revision", "study", "notes", "definition", "question"],
  },
];

export function loadPluginState() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLUGIN_STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export function savePluginState(state) {
  localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(state));
}

export function pluginsForPrompt(state, prompt = "") {
  const low = prompt.toLowerCase();
  return PLUGIN_CATALOG.filter((plugin) => {
    const status = state[plugin.id];
    if (!status?.installed || status.enabled === false) return false;
    const mentioned = plugin.aliases.some((alias) => low.includes(`@${alias.toLowerCase()}`));
    const relevant = plugin.triggers.some((trigger) => low.includes(trigger));
    return mentioned || relevant;
  }).map((plugin) => plugin.id);
}

export function getPluginMentionContext(state, value = "", cursorPosition = value.length) {
  const beforeCursor = String(value).slice(0, cursorPosition ?? String(value).length);
  const match = beforeCursor.match(/(^|\s)@([^@\n]*)$/);
  if (!match) return null;

  const rawQuery = match[2] || "";
  const query = rawQuery.trimStart();
  const normalizedQuery = query.toLowerCase();
  const installedPlugins = PLUGIN_CATALOG.filter((plugin) => state?.[plugin.id]?.installed);

  // A valid plugin name/alias followed by whitespace is a completed mention.
  // Later words belong to the prompt and must not continue filtering the picker.
  const completedMention = installedPlugins.some((plugin) => {
    const normalizedPluginName = plugin.name.toLowerCase();
    const completedNames = [
      plugin.name,
      ...plugin.aliases.filter((alias) =>
        !normalizedPluginName.startsWith(`${alias.toLowerCase()} `)
      ),
    ];

    return completedNames.some((name) => {
      const normalizedName = name.toLowerCase();
      return normalizedQuery.startsWith(normalizedName)
        && /^\s/.test(query.slice(name.length));
    });
  });
  if (completedMention) return null;

  return {
    query,
    start: beforeCursor.length - rawQuery.length - 1,
  };
}



export function pluginMentioned(state, prompt, pluginId) {
  const plugin = PLUGIN_CATALOG.find((item) => item.id === pluginId);
  const status = state[pluginId];
  if (!plugin || !status?.installed || status.enabled === false) return false;
  const low = String(prompt || "").toLowerCase();
  return plugin.aliases.some((alias) => low.includes(`@${alias.toLowerCase()}`));
}

export function removePluginMention(prompt, pluginId) {
  const plugin = PLUGIN_CATALOG.find((item) => item.id === pluginId);
  if (!plugin) return String(prompt || "").trim();
  return plugin.aliases
    .sort((a, b) => b.length - a.length)
    .reduce((text, alias) => text.replace(new RegExp(`@${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "ig"), ""), String(prompt || ""))
    .trim();
}
