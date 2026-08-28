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
    if (!status?.installed) return false;
    if (status.enabled) return true;
    return plugin.aliases.some((alias) => low.includes(`@${alias.toLowerCase()}`));
  }).map((plugin) => plugin.id);
}

