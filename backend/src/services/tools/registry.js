// Tool registry for the agentic loop.
//
// Each entry pairs an OpenAI-format JSON schema (what the model sees when it
// decides which tool to call) with a `run` executor that wraps one of VetroAI's
// existing services. The orchestrator used to decide all of this up-front with
// regexes in AIOrchestrator's *_TRIGGERS lists — the model never got a say, so
// it could not chain two lookups or skip a search it did not need. Everything
// here is read-only: no tool mutates state, spends credits, or takes an action
// on the user's behalf, so a hallucinated call costs a wasted round trip and
// nothing worse.
const logger = require("../../utils/logger");
const { searchWeb, searchImages } = require("../../controllers/searchController");
const { performDeepSearch } = require("../deepSearchService");
const cricketService = require("../cricketService");
const { getAstrologyData } = require("../astrologyService");

// Observations are re-sent to the model on every subsequent step, so an
// unbounded one would blow the context window three steps into a loop.
const MAX_OBSERVATION_CHARS = 6000;

function truncate(value, limit = MAX_OBSERVATION_CHARS) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[...truncated ${text.length - limit} characters]`;
}

function requireString(args, key, { max = 400 } = {}) {
  const raw = args?.[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`missing required string argument "${key}"`);
  }
  return raw.trim().slice(0, max);
}

const TOOL_CATALOG = Object.freeze({
  web_search: {
    status: (args) => `Searching the web for "${String(args?.query || "").slice(0, 60)}"...`,
    timeoutMs: 12000,
    schema: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the live web for current information: news, prices, scores, weather, recent events, or any fact that may have changed since training. Returns ranked snippets with source URLs. Prefer one focused query over a broad one, and call this again with a refined query if the first results are not specific enough.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query. Keep it short and keyword-dense, like something you would type into a search engine.",
            },
          },
          required: ["query"],
        },
      },
    },
    run: async (args) => {
      const query = requireString(args, "query");
      const { context } = await searchWeb(query);
      return context || `No web results found for "${query}".`;
    },
  },

  deep_research: {
    status: () => "Running deep research across multiple sources...",
    timeoutMs: 25000,
    schema: {
      type: "function",
      function: {
        name: "deep_research",
        description:
          "Run a multi-query research pass that fans out across several searches and returns a combined, de-duplicated source set. Slower and more expensive than web_search — use it only for broad or comparative questions that a single search cannot answer, not for a simple fact lookup.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The research topic, phrased as a full question rather than keywords.",
            },
          },
          required: ["query"],
        },
      },
    },
    run: async (args) => {
      const query = requireString(args, "query");
      const { context } = await performDeepSearch(query);
      return context || `No sources found for "${query}".`;
    },
  },

  image_search: {
    status: (args) => `Finding images of "${String(args?.query || "").slice(0, 60)}"...`,
    timeoutMs: 10000,
    schema: {
      type: "function",
      function: {
        name: "image_search",
        description:
          "Find real photographs of a specific named person, place, or thing. Use this only when the user wants to SEE something; do not call it for general explanatory questions that merely mention a noun.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to find pictures of." },
            limit: {
              type: "integer",
              description: "How many images to return, 1-6. Defaults to 4.",
              minimum: 1,
              maximum: 6,
            },
          },
          required: ["query"],
        },
      },
    },
    run: async (args) => {
      const query = requireString(args, "query");
      const limit = Math.min(Math.max(Number(args?.limit) || 4, 1), 6);
      const images = await searchImages(query, limit);
      if (!images.length) return `No images found for "${query}".`;
      return JSON.stringify(images);
    },
  },

  cricket_live_scores: {
    status: () => "Fetching live cricket scores...",
    timeoutMs: 10000,
    schema: {
      type: "function",
      function: {
        name: "cricket_live_scores",
        description:
          "Get the list of cricket matches currently live, with teams, scores, and match IDs. Call cricket_match_details afterwards for ball-by-ball detail on one of the returned match IDs.",
        parameters: { type: "object", properties: {} },
      },
    },
    run: async () => {
      const matches = await cricketService.getLiveMatches();
      if (!matches?.length) return "No cricket matches are live right now.";
      return JSON.stringify(matches);
    },
  },

  cricket_match_details: {
    status: () => "Pulling match details...",
    timeoutMs: 10000,
    schema: {
      type: "function",
      function: {
        name: "cricket_match_details",
        description:
          "Get detailed scorecard information for one cricket match, identified by a match ID from cricket_live_scores.",
        parameters: {
          type: "object",
          properties: {
            matchId: { type: "string", description: "Match ID returned by cricket_live_scores." },
          },
          required: ["matchId"],
        },
      },
    },
    run: async (args) => {
      const matchId = requireString(args, "matchId", { max: 64 });
      const details = await cricketService.getMatchDetails(matchId);
      if (!details) return `No details available for match "${matchId}".`;
      return JSON.stringify(details);
    },
  },

  astrology_chart: {
    status: () => "Casting the birth chart...",
    timeoutMs: 15000,
    schema: {
      type: "function",
      function: {
        name: "astrology_chart",
        description:
          "Compute a Vedic sidereal birth chart (Lahiri ayanamsa, whole-sign houses) with exact planetary degrees and the current dasha period. Requires full birth details — if the user has not given date, time, and city, ask them for the missing pieces instead of calling this with guesses.",
        parameters: {
          type: "object",
          properties: {
            year: { type: "integer", description: "Birth year, e.g. 1998." },
            month: { type: "integer", description: "Birth month, 1-12." },
            day: { type: "integer", description: "Day of month, 1-31." },
            hour: { type: "integer", description: "Hour of birth in 24h time, 0-23. Defaults to 12 if genuinely unknown." },
            minute: { type: "integer", description: "Minute of birth, 0-59. Defaults to 0." },
            city: { type: "string", description: "City of birth." },
          },
          required: ["year", "month", "day", "city"],
        },
      },
    },
    run: async (args) => {
      const details = {
        year: Number(args?.year),
        month: Number(args?.month),
        day: Number(args?.day),
        hour: Number.isFinite(Number(args?.hour)) ? Number(args.hour) : 12,
        minute: Number.isFinite(Number(args?.minute)) ? Number(args.minute) : 0,
        city: requireString(args, "city", { max: 120 }),
      };
      if (!details.year || !details.month || !details.day) {
        throw new Error("year, month and day are all required and must be numbers");
      }
      const data = await getAstrologyData(details);
      if (!data) return "The astrology service returned no data for those birth details. Tell the user it is unavailable rather than estimating a chart.";
      return JSON.stringify(data);
    },
  },
});

const TOOL_NAMES = Object.freeze(Object.keys(TOOL_CATALOG));

function getToolDefinitions() {
  return TOOL_NAMES.map((name) => TOOL_CATALOG[name].schema);
}

function statusFor(name, args) {
  const tool = TOOL_CATALOG[name];
  if (!tool) return "Working...";
  try {
    return tool.status(args);
  } catch {
    return "Working...";
  }
}

function parseArguments(rawArgs) {
  let args = rawArgs;
  if (typeof args === "string") {
    if (!args.trim()) return {};
    args = JSON.parse(args);
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args;
}

// Never throws: a failed tool is an observation the model reads and works
// around, not an error that kills the turn. Losing one lookup should degrade
// the answer, not replace it with an error page.
async function executeTool(name, rawArgs) {
  const tool = TOOL_CATALOG[name];
  if (!tool) {
    return {
      ok: false,
      observation: `Unknown tool "${name}". Available tools: ${TOOL_NAMES.join(", ")}. Answer from what you already know instead.`,
    };
  }

  let args;
  try {
    args = parseArguments(rawArgs);
  } catch {
    return {
      ok: false,
      observation: `The arguments for "${name}" were not valid JSON. Call it again with a well-formed JSON object, or answer without it.`,
    };
  }

  const startedAt = Date.now();
  let timer;
  try {
    // The underlying services all carry their own network timeouts; this race
    // is the outer guard so one slow provider cannot stall the whole loop.
    // The timer is cleared in `finally` — losing the race does not cancel it,
    // and an uncleared timer keeps the event loop alive for its full duration
    // after the tool has already answered.
    const observation = await Promise.race([
      tool.run(args),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${tool.timeoutMs}ms`)), tool.timeoutMs);
      }),
    ]);
    logger.info("toolRegistry.executed", { tool: name, ms: Date.now() - startedAt });
    return { ok: true, observation: truncate(observation) };
  } catch (err) {
    logger.warn("toolRegistry.failed", { tool: name, error: err.message, ms: Date.now() - startedAt });
    return {
      ok: false,
      observation: `Tool "${name}" failed: ${err.message}. Do not call it again with the same arguments — answer with what you have and say plainly what could not be fetched.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  TOOL_CATALOG,
  TOOL_NAMES,
  MAX_OBSERVATION_CHARS,
  getToolDefinitions,
  statusFor,
  executeTool,
  truncate,
};
