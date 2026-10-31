const logger = require("../utils/logger");
const { config } = require("../config/env");
const groqAdapter = require("../providers/groqAdapter");
const geminiAdapter = require("../providers/geminiAdapter");
const agnesAdapter = require("../providers/agnesAdapter");
const chatgptAdapter = require("../providers/chatgptAdapter");
const fableAdapter = require("../providers/fableAdapter");
const airouterAdapter = require("../providers/airouterAdapter");
const cohereAdapter = require("../providers/cohereAdapter");
const sarvamAdapter = require("../providers/sarvamAdapter");

// The picker's model names (most of which run in the browser) mapped to the
// backend provider of the same family. Without this, an unknown name such as
// "GPT-5.6 Sol" was ignored and the request went to whichever provider had the
// highest weight — so every browser-model web search was answered by the top-weighted gateway.
const PROVIDER_ALIASES = [
  [/^gpt[-\s]|openai|codex|chatgpt/i, "chatgpt"],
  [/claude|fable/i, "fable"],
  [/gemini|google/i, "gemini"],
  [/^groq$/i, "groq"],
  [/agnes/i, "agnes"],
  [/ai[\s_-]?router|deepseek/i, "airouter"],
  [/cohere/i, "cohere"],
  [/sarvam/i, "sarvam"],
];

function resolveProviderName(label) {
  const text = String(label || "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const alias = PROVIDER_ALIASES.find(([rx]) => rx.test(text));
  return alias ? alias[1] : lower;
}

// Modes that answer from live search results. AI Router's DeepSeek model thinks at length; that
// style is a poor fit there, so Auto prefers models that answer directly.
const SEARCH_MODES = new Set(["web_search", "research", "deep_search"]);

class ProviderManager {
  constructor() {
    this.providers = {
      chatgpt: {
        adapter: chatgptAdapter,
        weight: 85,
        score: 85,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["airouter", "groq", "agnes", "gemini", "cohere"],
      },
      fable: {
        adapter: fableAdapter,
        weight: 95,
        score: 95,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["airouter", "chatgpt", "groq", "agnes", "gemini", "cohere"],
      },
      airouter: {
        adapter: airouterAdapter,
        weight: 105,
        score: 105,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["fable", "chatgpt", "groq", "agnes", "gemini", "cohere"],
      },
      groq: {
        adapter: groqAdapter,
        weight: 80,
        score: 80,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["airouter", "chatgpt", "agnes", "gemini", "cohere"],
      },
      agnes: {
        adapter: agnesAdapter,
        weight: 100,
        score: 100,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["airouter", "groq", "gemini", "cohere"],
      },
      gemini: {
        adapter: geminiAdapter,
        weight: 50, // Lowered — free quota often exhausted
        score: 50,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["airouter", "groq", "agnes", "cohere"],
      },
      sarvam: {
        adapter: sarvamAdapter,
        // Below the general-purpose providers, so Auto keeps its current
        // picks; it answers when chosen in the picker.
        weight: 60,
        // Picked in the model picker, Sarvam answers alone: every message
        // starts with Sarvam even if an earlier one failed, and a timeout or
        // busy moment is retried on Sarvam rather than handed to another
        // model (AIOrchestrator, pickedAlone). Auto keeps skipping a failing
        // Sarvam and falls back as usual.
        retryWhenPicked: true,
        score: 60,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["airouter", "groq", "agnes", "gemini", "cohere"],
      },
      cohere: {
        adapter: cohereAdapter,
        // Deliberately the lowest weight so it's never auto-picked as the
        // primary provider — it only steps in once every other configured
        // provider above has failed or run out of credits.
        weight: 10,
        score: 10,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["airouter", "groq", "agnes", "gemini"],
      },
    };

    // Background health check loop - only in non-serverless
    if (!process.env.LAMBDA_TASK_ROOT) {
      this.healthCheckTimer = setInterval(() => this.checkHealth(), 15000); // every 15 s
      this.healthCheckTimer.unref?.();
    }
  }

  isConfigured(providerName) {
    const configured = {
      airouter: Boolean(config.airouterApiKey),
      chatgpt: Boolean(config.chatgptApiKey),
      fable: Boolean(config.fableRapidApiKey),
      groq: Boolean(config.groqApiKey),
      agnes: Boolean(config.agnesApiKey),
      gemini: Boolean(config.geminiApiKey),
      cohere: Boolean(config.cohereApiKey),
      sarvam: Boolean(config.sarvamApiKey),
    };
    return configured[providerName] === true;
  }

  getAvailableProviders({ includeSuspended = false } = {}) {
    return Object.keys(this.providers).filter((name) => {
      if (!this.isConfigured(name)) return false;
      return includeSuspended || !this.providers[name].isSuspended;
    });
  }

  async checkHealth() {
    for (const [name, p] of Object.entries(this.providers)) {
      if (p.isSuspended && this.cooledDown(p)) {
        logger.info(`ProviderManager: Re-testing suspended provider ${name}`);
        p.isSuspended = false;
        p.consecutiveErrors = 0;
      }
    }
  }

  resetAllProviders() {
    logger.warn("ProviderManager: All providers suspended — resetting all to recover.");
    for (const p of Object.values(this.providers)) {
      p.isSuspended = false;
      p.consecutiveErrors = 0;
    }
  }

  /**
   * The provider the user picked, when it is one that answers alone once
   * picked (retryWhenPicked) and is configured; otherwise null.
   */
  pickedAlone(preferredProvider) {
    const name = resolveProviderName(preferredProvider);
    const p = this.providers[name];
    return p?.retryWhenPicked && this.isConfigured(name) ? name : null;
  }

  getBestProvider(mode, preferredProvider) {
    // If user explicitly chose a provider, try it first if not suspended
    if (preferredProvider && !["undefined", "auto"].includes(preferredProvider.toLowerCase())) {
      const pref = resolveProviderName(preferredProvider);
      if (this.providers[pref] && this.isConfigured(pref)) {
        // Unsuspend if cooldown has passed, or straight away for a provider
        // that is always retried when picked.
        const p = this.providers[pref];
        if (p.isSuspended && (p.retryWhenPicked || this.cooledDown(p))) {
          p.isSuspended = false;
          p.consecutiveErrors = 0;
        }
        if (!p.isSuspended) return pref;
      }
    }

    // Auto-expire cooled-down suspensions before picking
    for (const [, p] of Object.entries(this.providers)) {
      if (p.isSuspended && this.cooledDown(p)) {
        p.isSuspended = false;
        p.consecutiveErrors = 0;
      }
    }

    const candidates = this.getAvailableProviders();

    // If all configured providers are suspended, reset only those providers.
    if (candidates.length === 0) {
      const configured = this.getAvailableProviders({ includeSuspended: true });
      if (configured.length === 0) return null;
      for (const name of configured) {
        this.providers[name].isSuspended = false;
        this.providers[name].consecutiveErrors = 0;
      }
      candidates.push(...configured);
    }

    // Sort by weighted score
    return candidates.sort((a, b) => {
      const pA = this.providers[a];
      const pB = this.providers[b];

      let scoreA = pA.weight;
      let scoreB = pB.weight;

      if (mode === "debugger" || mode === "coding") {
        if (a === "groq") scoreA += 50;
        if (b === "groq") scoreB += 50;
      } else if (mode === "deep_search" || mode === "analyst") {
        if (a === "gemini") scoreA += 50;
        if (b === "gemini") scoreB += 50;
      } else if (mode === "design") {
        // Whole hand-styled sites: Claude writes the strongest front-end
        // design, then GPT; the gateway's reasoning default lays out plainly.
        const designBoost = { fable: 60, chatgpt: 30 };
        scoreA += designBoost[a] || 0;
        scoreB += designBoost[b] || 0;
      }
      if (SEARCH_MODES.has(mode)) {
        if (a === "airouter") scoreA -= 60;
        if (b === "airouter") scoreB -= 60;
      }

      return scoreB - scoreA;
    })[0];
  }

  getFallbackProvider(failedProvider, excludedProviders = []) {
    const p = this.providers[failedProvider];
    const fallbackList = (p && p.fallbacks) ? p.fallbacks : ["airouter", "gemini", "groq", "agnes", "cohere"];
    const excluded = new Set([failedProvider, ...excludedProviders]);

    // Auto-expire cooled-down suspensions first
    for (const [, prov] of Object.entries(this.providers)) {
      if (prov.isSuspended && this.cooledDown(prov)) {
        prov.isSuspended = false;
        prov.consecutiveErrors = 0;
      }
    }

    for (const f of fallbackList) {
      if (this.providers[f] && this.isConfigured(f) && !this.providers[f].isSuspended && !excluded.has(f)) {
        return f;
      }
    }

    // Try any remaining configured provider before giving up.
    const remaining = this.getAvailableProviders().filter((name) => !excluded.has(name));
    if (remaining.length === 0) return null;
    return remaining.sort(
      (a, b) => this.providers[b].weight - this.providers[a].weight
    )[0];
  }

  updateMetrics(providerName, success, latency) {
    const p = this.providers[providerName];
    if (!p) return;

    if (success) {
      p.consecutiveErrors = 0;
      p.latency = p.latency === 0 ? latency : (p.latency * 0.8 + latency * 0.2);
      p.successRate = (p.successRate * 0.95 + 0.05);
    } else {
      p.consecutiveErrors++;
      p.successRate = (p.successRate * 0.9);
      // Only suspend after 5 consecutive failures so transient errors don't kill the provider
      if (p.consecutiveErrors >= 5) {
        logger.warn(`ProviderManager: Suspending ${providerName} after ${p.consecutiveErrors} consecutive errors`);
        p.isSuspended = true;
        p.lastFailure = Date.now();
        p.suspendedUntil = p.lastFailure + p.cooldown;
      }
    }
  }

  // `durationMs` defaults to the provider's short cooldown; a key or billing
  // problem passes a longer one so every request doesn't wait on it again.
  suspendProvider(providerName, reason, durationMs) {
    const p = this.providers[providerName];
    if (!p) return;
    logger.warn(`ProviderManager: Suspending ${providerName}. Reason: ${reason}`);
    p.isSuspended = true;
    p.lastFailure = Date.now();
    p.suspendedUntil = p.lastFailure + (durationMs ?? p.cooldown);
  }

  cooledDown(p) {
    return Date.now() >= (p.suspendedUntil ?? p.lastFailure + p.cooldown);
  }

  getAdapter(name) {
    return this.providers[name]?.adapter;
  }

  getStats() {
    const stats = {};
    for (const [name, p] of Object.entries(this.providers)) {
      stats[name] = {
        configured: this.isConfigured(name),
        status: !this.isConfigured(name)
          ? "unconfigured"
          : (p.isSuspended ? "suspended" : (p.consecutiveErrors > 0 ? "degraded" : "healthy")),
        latency: Math.round(p.latency),
        successRate: Math.round(p.successRate * 100) / 100,
      };
    }
    return stats;
  }
}

module.exports = new ProviderManager();
