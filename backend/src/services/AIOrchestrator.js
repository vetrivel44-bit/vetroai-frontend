const logger = require("../utils/logger");
const providerManager = require("./ProviderManager");
const { performDeepSearch } = require("./deepSearchService");
const { searchWeb } = require("../controllers/searchController");

class AIOrchestrator {
  constructor() {
    this.VISUALIZATION_TRIGGERS = [
      /\b(compare|comparison|versus|vs|difference between|ranking|top|highest|lowest|better than|performance comparison)\b/i,
      /\b(trend|growth|decline|over time|history|historical|yearly|monthly|daily|timeline|progress|increase|decrease|analytics over time)\b/i,
      /\b(percentage|distribution|share|market share|vote share|breakdown|allocation|composition|proportion|split)\b/i,
      /\b(benchmark|capabilities|strengths|weaknesses|score comparison|performance metrics|attribute comparison|analysis across categories)\b/i,
      /\b(revenue|stock|profit|sales|finance|earnings|analytics|dashboard|KPI|metrics|investment|market analysis)\b/i,
      /\b(seats|vote share|election prediction|constituency analysis|alliance comparison|political analysis)\b/i,
      /\b(roadmap|releases|launch history|milestones|events over time|chronological)\b/i,
      /\b(seasonal pattern|cyclic|directional|rotation analysis)\b/i,
      /\b(plot|graph|chart|function|y\s*=|f\(x\)\s*=)\b/i,
    ];

    this.SEARCH_TRIGGERS = [
      /\b(today|tonight|now|current|currently|live|latest|recent|breaking|news)\b/i,
      /\b(2024|2025|2026|this (year|month|week|day))\b/i,
      /\b(who (is|was|won|leads|runs)|what is the (score|price|rate|status))\b/i,
      /\b(stock|crypto|bitcoin|market|weather|election|war|match|game|ipl|cricket|football)\b/i,
      /\b(just (happened|announced|released|launched))\b/i,
      /\b(trending|viral|happening)\b/i,
    ];
  }

  needsWebSearch(q) {
    return this.SEARCH_TRIGGERS.some(rx => rx.test(q));
  }

  needsVisualization(q) {
    return this.VISUALIZATION_TRIGGERS.some(rx => rx.test(q));
  }

  async buildSystemPrompt(mode, context = {}) {
    const { userQuery, webContext, personaPrompt, customInstructions, memories = [] } = context;
    const now = new Date();
    const nowStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const nowISO = now.toISOString().slice(0, 10);

    let sys = [
      `TODAY IS: ${nowStr} (${nowISO}). Current year: ${now.getFullYear()}.`,
      `NEVER say an event "hasn't happened yet" if it's plausible given today's date.`,
      memories.length ? `USER CONTEXT:\n${memories.map(m => `• ${m}`).join("\n")}` : "",
      personaPrompt || "",
      customInstructions || "",
    ].filter(Boolean).join("\n\n");

    // Standard Visualization Rules (Everywhere)
    sys += `\n\n## VISUALIZATION RULES
Graphs should automatically appear in ANY mode when the user query indicates that visualization will improve understanding.

### TRIGGERS FOR GRAPHS
1. **Comparison** (compare, vs, ranking) -> Use: \`bar\`, \`horizontal-bar\`, \`radar\`
2. **Trend** (trend, growth, history, over time) -> Use: \`line\`, \`area\`, \`timeline\`
3. **Distribution** (percentage, share, breakdown) -> Use: \`pie\`, \`donut\`, \`stacked-bar\`
4. **Math Functions** (plot, y=x^2, sine wave) -> Use: \`line\` (high density points)

### MATH FUNCTION PLOTTING
If the user asks to plot a function (e.g., y=x^2, sine wave), generate a high-density dataset:
- Use at least 50 points for smooth curves.
- Data format: \`[{"label": "-5", "value": 25}, {"label": "-4.8", "value": 23.04}, ...]\`
- Include the function name in the title.

### CHART FORMAT
Include a JSON block with type 'chart':
\`\`\`json
{
  "type": "chart",
  "chartType": "line",
  "library": "recharts",
  "title": "Plot of f(x) = x²",
  "data": [{"label": "-5", "value": 25}, ...]
}
\`\`\`

### MAP & ROUTE RULES
If location/directions requested, use:
\`\`\`json
{ "type": "location", "place": "Name", "summary": "..." }
\`\`\`
or
\`\`\`json
{ "type": "route", "origin": "A", "destination": "B", "summary": "..." }
\`\`\`
`;

    if (webContext) {
      sys += `\n\n🌐 LIVE SEARCH RESULTS (treat as PRIMARY source):\n${webContext}\n\nRULES: Base answer DIRECTLY on these results. Quote exact numbers/dates. NEVER say "I don't have real-time data". Cite source URLs.`;
    }

    if (mode === "debugger" || mode === "coding") {
      sys += "\n\nYou are an expert developer. Provide clean, secure, production-ready code with explanations of trade-offs.";
    }

    if (mode === "analyst") {
      sys += "\n\nYou are a senior data analyst. Provide deep insights, identify trends, and ALWAYS include a visualization if data allows.";
    }

    sys += "\n\n⚡ OUTPUT COMPLETENESS: Finish your response fully. Close all code fences. Never end mid-sentence.";

    return sys;
  }

  async processRequest(reqId, params, res) {
    const { messages, mode, provider: preferredProvider, options, memories } = params;
    const userQuery = messages[messages.length - 1]?.content || "";
    
    let currentProviderName = providerManager.getBestProvider(mode, preferredProvider);
    let attempts = 0;
    const maxAttempts = 3;
    let success = false;

    // Intent detection
    const shouldSearch = mode === "web_search" || mode === "deep_search" || this.needsWebSearch(userQuery);
    let webContext = null;

    if (shouldSearch) {
      this.sendVetroEvent(res, "status", "Searching the web for latest info...");
      try {
        const searchRes = mode === "deep_search" ? await performDeepSearch(userQuery) : await searchWeb(userQuery);
        webContext = searchRes.context;
      } catch (err) {
        logger.error("AIOrchestrator.searchError", { reqId, error: err.message });
      }
    }

    const sysPrompt = await this.buildSystemPrompt(mode, { userQuery, webContext, memories });
    const fullMessages = [{ role: "system", content: sysPrompt }, ...messages.slice(-10)];

    while (attempts < maxAttempts && !success) {
      attempts++;
      const adapter = providerManager.getAdapter(currentProviderName);
      
      if (!adapter) {
        currentProviderName = providerManager.getFallbackProvider(currentProviderName);
        continue;
      }

      this.sendVetroEvent(res, "status", attempts === 1 ? `Thinking with ${currentProviderName}...` : `Retrying with ${currentProviderName}...`);

      const startTime = Date.now();
      try {
        const stream = await adapter.generateStream(fullMessages, options);
        
        // Handle stream
        await this.pipeStream(stream, res, currentProviderName);
        
        providerManager.updateMetrics(currentProviderName, true, Date.now() - startTime);
        success = true;
      } catch (err) {
        logger.error(`AIOrchestrator.error [${currentProviderName}]`, { reqId, error: err.message });
        providerManager.updateMetrics(currentProviderName, false, Date.now() - startTime);
        
        if (attempts < maxAttempts) {
          const nextProvider = providerManager.getFallbackProvider(currentProviderName);
          this.sendVetroEvent(res, "status", `Provider ${currentProviderName} failed. Switching to ${nextProvider}...`);
          currentProviderName = nextProvider;
        } else {
          this.sendVetroEvent(res, "error", "The AI service is currently experiencing high demand. Please try again in a few moments.");
        }
      }
    }
    res.end();
  }

  sendVetroEvent(res, type, data) {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }

  async pipeStream(stream, res, provider) {
    let fullContent = "";

    try {
      // 1. Handle Async Iterables (SDKs like Groq, Mistral)
      if (Symbol.asyncIterator in stream) {
        for await (const chunk of stream) {
          const content = this.normalizeChunk(chunk, provider);
          if (content) {
            fullContent += content;
            this.sendVetroEvent(res, "content", content);
          }
        }
      }
      // 2. Handle Node.js Readable streams
      else if (stream.on) {
        await new Promise((resolve, reject) => {
          stream.on("data", (chunk) => {
            const content = this.normalizeChunk(chunk, provider);
            if (content) {
              fullContent += content;
              this.sendVetroEvent(res, "content", content);
            }
          });
          stream.on("end", resolve);
          stream.on("error", reject);
        });
      }
      // 3. Handle Web Streams (fetch res.body)
      else if (stream.getReader) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const raw = decoder.decode(value, { stream: true });
          const content = this.normalizeChunk(raw, provider);
          if (content) {
            fullContent += content;
            this.sendVetroEvent(res, "content", content);
          }
        }
      }
    } catch (err) {
      logger.error(`AIOrchestrator.pipeStream.error [${provider}]`, { error: err.message });
      throw err;
    }

    // Check for truncation (simplistic check)
    if (this.isLikelyTruncated(fullContent)) {
      logger.info("AIOrchestrator: Truncation detected");
      this.sendVetroEvent(res, "status", "Finishing long response...");
    }
    
    return fullContent;
  }

  isLikelyTruncated(text) {
    if (!text || text.length < 500) return false;
    const fences = (text.match(/```/g) || []).length;
    if (fences % 2 !== 0) return true;
    if (/[([{,=]\s*$/.test(text)) return true;
    return false;
  }

  normalizeChunk(chunk, provider) {
    if (!chunk) return null;

    // 1. Handle Object Chunks (SDK Deltas)
    if (typeof chunk === "object") {
      // OpenAI / Groq / SambaNova / Mistral / OpenRouter standard
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) return delta.content;
      
      // Gemini / Vertex AI standard
      const part = chunk.candidates?.[0]?.content?.parts?.[0];
      if (part?.text) return part.text;
      
      // Generic .text field
      if (chunk.text) return chunk.text;

      // Handle the case where the SDK returns a finished signal object or empty delta
      return null;
    }

    // 2. Handle String Chunks (Direct Streams)
    const text = String(chunk);
    
    // Gemini beta stream sometimes returns JSON blocks as strings
    if (provider === "gemini" && (text.trim().startsWith("{") || text.trim().startsWith("["))) {
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
           return json.map(c => c.candidates?.[0]?.content?.parts?.[0]?.text || "").join("");
        }
        return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } catch { return text; }
    }

    return text;
  }
}

module.exports = new AIOrchestrator();
