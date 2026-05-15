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
        cooldown: 60000,
        fallbacks: ["sambanova", "mistral"],
      },
      gemini: {
        adapter: geminiAdapter,
        weight: 90,
        score: 90,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 60000,
        fallbacks: ["groq", "mistral"],
      },
      mistral: {
        adapter: mistralAdapter,
        weight: 80,
        score: 80,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 60000,
        fallbacks: ["groq", "sambanova"],
      },
      sambanova: {
        adapter: sambanovaAdapter,
        weight: 70,
        score: 70,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 60000,
        fallbacks: ["groq", "mistral"],
      },
    };

    // Background health check loop
    setInterval(() => this.checkHealth(), 30000);
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

  getBestProvider(mode, preferredProvider) {
    // If user explicitly chose a provider, try it first if not suspended
    if (preferredProvider && preferredProvider !== "undefined") {
      const pref = preferredProvider.toLowerCase();
      if (this.providers[pref] && !this.providers[pref].isSuspended) {
        return pref;
      }
    }

    // Weighting logic
    const candidates = Object.keys(this.providers).filter(name => !this.providers[name].isSuspended);
    
    if (candidates.length === 0) return "groq"; // Last resort

    // Sort by score (weight + successRate - normalizedLatency)
    return candidates.sort((a, b) => {
      const pA = this.providers[a];
      const pB = this.providers[b];
      
      let scoreA = pA.weight;
      let scoreB = pB.weight;

      // Intent-based weighting
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
    if (!p || !p.fallbacks) return "groq";
    
    for (const f of p.fallbacks) {
      if (this.providers[f] && !this.providers[f].isSuspended) {
        return f;
      }
    }
    return "groq";
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
      if (p.consecutiveErrors >= 3) {
        logger.warn(`ProviderManager: Suspending ${providerName} due to consecutive errors`);
        p.isSuspended = true;
        p.lastFailure = Date.now();
      }
    }
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
