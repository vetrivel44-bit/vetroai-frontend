const logger = require("../utils/logger");
const groqAdapter = require("../providers/groqAdapter");
const geminiAdapter = require("../providers/geminiAdapter");
const mistralAdapter = require("../providers/mistralAdapter");
const sambanovaAdapter = require("../providers/sambanovaAdapter");

class ProviderManager {
  constructor() {
    this.providers = {
      groq: {
        adapter: groqAdapter,
        weight: 100,
        score: 100,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["mistral", "sambanova", "gemini"],
      },
      mistral: {
        adapter: mistralAdapter,
        weight: 90,
        score: 90,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["groq", "sambanova", "gemini"],
      },
      sambanova: {
        adapter: sambanovaAdapter,
        weight: 80,
        score: 80,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["groq", "mistral", "gemini"],
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
        fallbacks: ["groq", "mistral", "sambanova"],
      },
    };

    // Background health check loop - only in non-serverless
    if (!process.env.LAMBDA_TASK_ROOT) {
      setInterval(() => this.checkHealth(), 15000); // every 15 s
    }
  }

  async checkHealth() {
    for (const [name, p] of Object.entries(this.providers)) {
      if (p.isSuspended && Date.now() - p.lastFailure > p.cooldown) {
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

  getBestProvider(mode, preferredProvider) {
    // If user explicitly chose a provider, try it first if not suspended
    if (preferredProvider && preferredProvider !== "undefined") {
      const pref = preferredProvider.toLowerCase();
      if (this.providers[pref]) {
        // Unsuspend if cooldown has passed
        const p = this.providers[pref];
        if (p.isSuspended && Date.now() - p.lastFailure > p.cooldown) {
          p.isSuspended = false;
          p.consecutiveErrors = 0;
        }
        if (!p.isSuspended) return pref;
      }
    }

    // Auto-expire cooled-down suspensions before picking
    for (const [, p] of Object.entries(this.providers)) {
      if (p.isSuspended && Date.now() - p.lastFailure > p.cooldown) {
        p.isSuspended = false;
        p.consecutiveErrors = 0;
      }
    }

    const candidates = Object.keys(this.providers).filter(name => !this.providers[name].isSuspended);

    // If ALL are still suspended, force-reset and use all
    if (candidates.length === 0) {
      this.resetAllProviders();
      candidates.push(...Object.keys(this.providers));
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
      } else if (mode === "creative") {
        if (a === "mistral") scoreA += 50;
        if (b === "mistral") scoreB += 50;
      }

      return scoreB - scoreA;
    })[0];
  }

  getFallbackProvider(failedProvider) {
    const p = this.providers[failedProvider];
    const fallbackList = (p && p.fallbacks) ? p.fallbacks : ["gemini", "sambanova", "mistral", "groq"];

    // Auto-expire cooled-down suspensions first
    for (const [, prov] of Object.entries(this.providers)) {
      if (prov.isSuspended && Date.now() - prov.lastFailure > prov.cooldown) {
        prov.isSuspended = false;
        prov.consecutiveErrors = 0;
      }
    }

    for (const f of fallbackList) {
      if (this.providers[f] && !this.providers[f].isSuspended) {
        return f;
      }
    }

    // All fallbacks exhausted — reset everything and pick highest weight
    this.resetAllProviders();
    return Object.keys(this.providers).sort(
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
      }
    }
  }

  suspendProvider(providerName, reason) {
    const p = this.providers[providerName];
    if (!p) return;
    logger.warn(`ProviderManager: Suspending ${providerName}. Reason: ${reason}`);
    p.isSuspended = true;
    p.lastFailure = Date.now();
  }

  getAdapter(name) {
    return this.providers[name]?.adapter;
  }

  getStats() {
    const stats = {};
    for (const [name, p] of Object.entries(this.providers)) {
      stats[name] = {
        status: p.isSuspended ? "suspended" : (p.consecutiveErrors > 0 ? "degraded" : "healthy"),
        latency: Math.round(p.latency),
        successRate: Math.round(p.successRate * 100) / 100,
      };
    }
    return stats;
  }
}

module.exports = new ProviderManager();
