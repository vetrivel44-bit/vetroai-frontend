// Trigger sync 2026-05-15 18:28
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
    const nowISO = now.toISOString().slice(0, 10);

    // ── Core system prompt ──
    let sys = `You are VetroAI, a helpful AI assistant. Today is ${nowISO}.`;

    // CRITICAL: Do NOT start responses with headings like "# Introduction" or "## Introduction".
    // Respond directly and conversationally. For greetings, respond naturally — not with structured sections.
    sys += `\n\nCRITICAL: NEVER start your response with a heading (e.g. "# Introduction", "## Overview"). Jump straight into the answer. For simple greetings or questions, respond conversationally without markdown headers.`;

    if (memories.length) {
      sys += `\nUser context: ${memories.map(m => `• ${m}`).join(" | ")}`;
    }
    if (personaPrompt) sys += `\n${personaPrompt}`;
    if (customInstructions) sys += `\n\nUser instructions: ${customInstructions}`;

    // Mode-specific instructions
    if (mode === "debugger" || mode === "coding") {
      sys += "\nYou are an expert developer. Give clean, production-ready code with brief explanations.";
    } else if (mode === "analyst") {
      sys += "\nYou are a data analyst. Always include a chart JSON block when data allows.";
    } else if (mode === "creative") {
      sys += "\nYou are a creative writer. Be vivid, imaginative, and original.";
    } else if (mode === "research") {
      sys += "\nYou are a research assistant. Provide well-cited, comprehensive answers.";
    } else if (mode === "deep_search") {
      sys += "\nYou are a deep research AI. Analyze multiple angles and cite your sources clearly.";
    }

    // Web context
    if (webContext) {
      sys += `\n\nLIVE SEARCH RESULTS (use these to give accurate, up-to-date answers):\n${webContext}\nBase your answer on these results. Cite URLs where relevant.`;
    }

    // Chart format (only injected when visualization is likely needed)
    if (userQuery && this.needsVisualization(userQuery)) {
      sys += `\n\nWhen data fits a chart, embed this JSON block:\n\`\`\`json\n{"type":"chart","chartType":"bar","title":"...","data":[{"label":"A","value":10}]}\n\`\`\``;
    }

    // Location/route
    sys += `\nFor location queries use: \`\`\`json\n{"type":"location","place":"Name","summary":"..."}\n\`\`\``;

    // Formatting rules
    sys += `\n\nFormatting: Be direct and concise. Only use ## headers for long multi-section responses. Use **bold** for key terms, bullet lists for multiple items, and markdown tables for comparisons. Never add filler like "Certainly!" or "Great question!". Finish responses fully.`;

    return sys;
  }

  async processRequest(reqId, params, res) {
    const { messages, mode, provider: preferredProvider, options, memories } = params;
    const userQuery = messages[messages.length - 1]?.content || "";
    
    let currentProviderName = providerManager.getBestProvider(mode, preferredProvider);
    let attempts = 0;
    const maxAttempts = 3;
    let success = false;

    // Intent detection — also support explicit webSearch flag from frontend
    const shouldSearch = mode === "web_search" || mode === "deep_search" || mode === "research" ||
      params.webSearch === true || params.webSearch === "true" ||
      this.needsWebSearch(userQuery);
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

    const sysPrompt = await this.buildSystemPrompt(mode, { userQuery, webContext, memories, customInstructions: params.systemPrompt });
    let fullMessages = [{ role: "system", content: sysPrompt }, ...messages.slice(-10)];
    // Prevent empty assistant messages (Mistral error)
    fullMessages = fullMessages.filter(m => {
      if (m.role === "assistant" && !m.content && (!m.tool_calls || m.tool_calls.length === 0)) return false;
      return true;
    });

    while (attempts < maxAttempts && !success) {
      attempts++;
      const adapter = providerManager.getAdapter(currentProviderName);
      
      if (!adapter) {
        logger.error(`AIOrchestrator: No adapter for ${currentProviderName}`);
        const nextProvider = providerManager.getFallbackProvider(currentProviderName);
        if (nextProvider === currentProviderName) break; // Avoid loop
        currentProviderName = nextProvider;
        continue;
      }

      this.sendVetroEvent(res, "status", attempts === 1 ? `Consulting ${currentProviderName}...` : `Re-routing to ${currentProviderName}...`);
      logger.info(`AIOrchestrator: Attempt ${attempts} using ${currentProviderName}`, { reqId });

      const startTime = Date.now();
      try {
        const stream = await adapter.generateStream(fullMessages, options);
        
        if (!stream) throw new Error("Provider returned empty stream");

        // Handle stream
        await this.pipeStream(stream, res, currentProviderName);
        
        providerManager.updateMetrics(currentProviderName, true, Date.now() - startTime);
        success = true;
      } catch (err) {
        logger.error(`AIOrchestrator.error [${currentProviderName}]`, { reqId, error: err.message });
        providerManager.updateMetrics(currentProviderName, false, Date.now() - startTime);
        
        const isRateLimit = /rate limit|429|too many requests/i.test(err.message);
        if (isRateLimit) {
          providerManager.suspendProvider(currentProviderName, "Rate limit reached");
        }
        
        if (attempts < maxAttempts) {
          const nextProvider = providerManager.getFallbackProvider(currentProviderName);
          const friendlyMsg = isRateLimit 
            ? `Model ${currentProviderName} is temporarily busy. Switching to another AI model…`
            : `Issue with ${currentProviderName}. Switching to another model…`;
          
          this.sendVetroEvent(res, "clear", "");
          this.sendVetroEvent(res, "status", friendlyMsg);
          currentProviderName = nextProvider;
          
          // Exponential backoff
          const backoffTime = Math.pow(2, attempts) * 1000;
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        } else {
          this.sendVetroEvent(res, "error", "All available AI models are currently at capacity. Please try again in 30 seconds.");
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
    const decoder = new TextDecoder();
    let buffer = "";

    const processTextChunk = (textChunk) => {
      buffer += textChunk;
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep partial line
      
      let chunkContent = "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const content = this.normalizeChunk(line, provider);
        if (content) {
          chunkContent += content;
        }
      }
      return chunkContent;
    };

    try {
      // 1. Handle Async Iterables (SDKs or Web ReadableStreams)
      if (Symbol.asyncIterator in stream) {
        for await (const chunk of stream) {
          // If it is an SDK object payload (e.g. from Groq SDK), process directly
          if (typeof chunk === "object" && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
            const content = this.normalizeChunk(chunk, provider);
            if (content) {
              fullContent += content;
              this.sendVetroEvent(res, "content", content);
            }
          } else {
            // Otherwise, decode binary/text data and parse by line
            const text = (chunk instanceof Uint8Array || Buffer.isBuffer(chunk))
              ? decoder.decode(chunk, { stream: true })
              : String(chunk);
            const content = processTextChunk(text);
            if (content) {
              fullContent += content;
              this.sendVetroEvent(res, "content", content);
            }
          }
        }
      }
      // 2. Handle Node.js Readable streams
      else if (stream.on) {
        await new Promise((resolve, reject) => {
          stream.on("data", (chunk) => {
            if (typeof chunk === "object" && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
              const content = this.normalizeChunk(chunk, provider);
              if (content) {
                fullContent += content;
                this.sendVetroEvent(res, "content", content);
              }
            } else {
              const text = (chunk instanceof Uint8Array || Buffer.isBuffer(chunk))
                ? decoder.decode(chunk, { stream: true })
                : String(chunk);
              const content = processTextChunk(text);
              if (content) {
                fullContent += content;
                this.sendVetroEvent(res, "content", content);
              }
            }
          });
          stream.on("end", resolve);
          stream.on("error", reject);
        });
      }
      // 3. Handle Web Streams with getReader
      else if (stream.getReader) {
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value, { stream: true });
          const content = processTextChunk(text);
          if (content) {
            fullContent += content;
            this.sendVetroEvent(res, "content", content);
          }
        }
      }

      // Flush remaining buffer
      if (buffer && buffer.trim()) {
        const content = this.normalizeChunk(buffer, provider);
        if (content) {
          fullContent += content;
          this.sendVetroEvent(res, "content", content);
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

    // Decode binary buffers/arrays into strings first
    if (chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) {
      chunk = new TextDecoder().decode(chunk);
    }

    // 1. Handle SDK Object Chunks (e.g. Groq SDK returned choices)
    if (typeof chunk === "object") {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) return delta.content;
      
      const part = chunk.candidates?.[0]?.content?.parts?.[0];
      if (part?.text) return part.text;
      
      if (chunk.text) return chunk.text;
      return null;
    }

    // 2. Handle String Chunks (Mistral, SambaNova, Gemini raw text stream)
    const rawText = chunk;
    
    // Handle Gemini raw JSON stream (often wrapped in [ ])
    if (provider === "gemini") {
      try {
        const text = rawText.trim();
        if (text.startsWith(",") || text.startsWith("[") || text.startsWith("]")) {
           // Handle common JSON stream artifacts
           const cleaned = text.replace(/^[,\[\]\s]+|[,\[\]\s]+$/g, "");
           if (!cleaned) return null;
           const json = JSON.parse(cleaned);
           return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
        const json = JSON.parse(text);
        return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } catch { /* Fall through to raw text if parsing fails */ }
    }

    // Handle standard SSE format (data: {...})
    if (rawText.includes("data: ")) {
      const lines = rawText.split("\n");
      let content = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const text = json.choices?.[0]?.delta?.content || "";
            content += text;
            if (text) logger.info(`normalizeChunk [${provider}]`, { text });
          } catch (e) {
            // Partial JSON or garbage
          }
        }
      }
      return content || null;
    }

    return rawText;
  }
}

module.exports = new AIOrchestrator();
