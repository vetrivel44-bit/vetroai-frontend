const logger = require("../utils/logger");
const { config } = require("../config/env");
const groqAdapter = require("../providers/groqAdapter");
const geminiAdapter = require("../providers/geminiAdapter");
const mistralAdapter = require("../providers/mistralAdapter");
const sambanovaAdapter = require("../providers/sambanovaAdapter");
const agnesAdapter = require("../providers/agnesAdapter");
const chatgptAdapter = require("../providers/chatgptAdapter");
const fableAdapter = require("../providers/fableAdapter");
const plugskyAdapter = require("../providers/plugskyAdapter");
const cohereAdapter = require("../providers/cohereAdapter");

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
        fallbacks: ["plugsky", "groq", "mistral", "agnes", "sambanova", "gemini", "cohere"],
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
        fallbacks: ["plugsky", "chatgpt", "groq", "mistral", "agnes", "sambanova", "gemini", "cohere"],
      },
      plugsky: {
        adapter: plugskyAdapter,
        weight: 105,
        score: 105,
        latency: 0,
        successRate: 1,
        consecutiveErrors: 0,
        isSuspended: false,
        lastFailure: 0,
        cooldown: 20000,
        fallbacks: ["fable", "chatgpt", "groq", "mistral", "agnes", "sambanova", "gemini", "cohere"],
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
        fallbacks: ["plugsky", "chatgpt", "agnes", "mistral", "sambanova", "gemini", "cohere"],
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
        fallbacks: ["plugsky", "groq", "sambanova", "agnes", "gemini", "cohere"],
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
        fallbacks: ["plugsky", "mistral", "groq", "sambanova", "gemini", "cohere"],
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
        fallbacks: ["plugsky", "groq", "mistral", "agnes", "gemini", "cohere"],
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
        fallbacks: ["plugsky", "groq", "mistral", "agnes", "sambanova", "cohere"],
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
        fallbacks: ["plugsky", "groq", "mistral", "agnes", "sambanova", "gemini"],
      },
    };

    // Per-provider rolling request log + learned rate-limit budget, so a
    // provider that's about to 429 gets skipped up front instead of being
    // discovered mid-stream (which costs the user a full attempt + backoff
    // before the fallback chain even starts). `rpmBudget` starts generous
    // and self-corrects downward the first time a provider actually returns
    // a 429 — see recordRateLimitHit — then slowly relaxes again once it's
    // been healthy for a while, so a temporary provider-side throttle
    // doesn't permanently cap it.
    for (const [name, p] of Object.entries(this.providers)) {
      p.requestLog = [];
      p.rpmBudget = Number(process.env[`${name.toUpperCase()}_RPM_BUDGET`]) || 60;
      p.learnedBudget = p.rpmBudget;
    }

    // Background health check loop - only in non-serverless
    if (!process.env.LAMBDA_TASK_ROOT) {
      this.healthCheckTimer = setInterval(() => this.checkHealth(), 15000); // every 15 s
      this.healthCheckTimer.unref?.();
    }
  }

  // Call right before dispatching an attempt to `providerName`, so its
  // near-limit check on the *next* request reflects this one.
  recordRequest(providerName) {
    const p = this.providers[providerName];
    if (!p) return;
    const now = Date.now();
    p.requestLog.push(now);
    // Trim to the last 60s — this doubles as the "how many calls in the
    // current window" count used by isNearLimit below.
    const cutoff = now - 60000;
    while (p.requestLog.length && p.requestLog[0] < cutoff) p.requestLog.shift();
  }

  // True once a provider is close enough to its (learned) per-minute budget
  // that routing another request to it is likely to just draw a 429.
  isNearLimit(providerName) {
    const p = this.providers[providerName];
    if (!p) return false;
    const cutoff = Date.now() - 60000;
    const recent = p.requestLog.filter((t) => t >= cutoff).length;
    return recent >= p.learnedBudget * 0.85;
  }

  // Called from AIOrchestrator when a provider actually returns a 429.
  // Ratchets its learned budget down to just under what it was actually
  // handling when it broke, so future routing respects the real ceiling
  // instead of the generic default.
  recordRateLimitHit(providerName) {
    const p = this.providers[providerName];
    if (!p) return;
    const cutoff = Date.now() - 60000;
    const recent = p.requestLog.filter((t) => t >= cutoff).length;
    p.learnedBudget = Math.max(1, recent - 1);
    logger.warn(`ProviderManager: learned tighter rate budget for ${providerName}`, { learnedBudget: p.learnedBudget });
  }

  isConfigured(providerName) {
    const configured = {
      plugsky: Boolean(config.plugskyApiKey),
      chatgpt: Boolean(config.chatgptApiKey),
      fable: Boolean(config.fableRapidApiKey),
      groq: Boolean(config.groqApiKey),
      mistral: Boolean(config.mistralApiKey),
      agnes: Boolean(config.agnesApiKey),
      sambanova: Boolean(config.sambanovaApiKey),
      gemini: Boolean(config.geminiApiKey),
      cohere: Boolean(config.cohereApiKey),
    };
    return configured[providerName] === true;
  }

  getAvailableProviders({ includeSuspended = false, includeNearLimit = false } = {}) {
    return Object.keys(this.providers).filter((name) => {
      if (!this.isConfigured(name)) return false;
      if (!includeSuspended && this.providers[name].isSuspended) return false;
      if (!includeNearLimit && this.isNearLimit(name)) return false;
      return true;
    });
  }

  async checkHealth() {
    for (const [name, p] of Object.entries(this.providers)) {
      if (p.isSuspended && Date.now() - p.lastFailure > p.cooldown) {
        logger.info(`ProviderManager: Re-testing suspended provider ${name}`);
        p.isSuspended = false;
        p.consecutiveErrors = 0;
      }
      // Slowly relax a learned budget back toward the configured ceiling —
      // a provider that hit a 429 an hour ago has likely recovered, and a
      // permanently depressed budget would keep routing away from it forever.
      if (p.learnedBudget < p.rpmBudget) p.learnedBudget = Math.min(p.rpmBudget, p.learnedBudget + 1);
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
    // If user explicitly chose a provider, try it first if not suspended and
    // not already close to its rate-limit budget — routing to it anyway
    // would very likely just draw a 429 the user then has to wait out.
    if (preferredProvider && !["undefined", "auto"].includes(preferredProvider.toLowerCase())) {
      const pref = preferredProvider.toLowerCase();
      if (this.providers[pref] && this.isConfigured(pref)) {
        // Unsuspend if cooldown has passed
        const p = this.providers[pref];
        if (p.isSuspended && Date.now() - p.lastFailure > p.cooldown) {
          p.isSuspended = false;
          p.consecutiveErrors = 0;
        }
        if (!p.isSuspended && !this.isNearLimit(pref)) return pref;
      }
    }

    // Auto-expire cooled-down suspensions before picking
    for (const [, p] of Object.entries(this.providers)) {
      if (p.isSuspended && Date.now() - p.lastFailure > p.cooldown) {
        p.isSuspended = false;
        p.consecutiveErrors = 0;
      }
    }

    const candidates = this.getAvailableProviders();

    // If every configured provider is either suspended or near its budget,
    // that's not really "all down" — pick from the full set anyway rather
    // than tell the user nothing is available.
    if (candidates.length === 0) {
      const configured = this.getAvailableProviders({ includeSuspended: true, includeNearLimit: true });
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
      } else if (mode === "creative") {
        if (a === "mistral") scoreA += 50;
        if (b === "mistral") scoreB += 50;
      }

      return scoreB - scoreA;
    })[0];
  }

  getFallbackProvider(failedProvider, excludedProviders = []) {
    const p = this.providers[failedProvider];
    const fallbackList = (p && p.fallbacks) ? p.fallbacks : ["plugsky", "gemini", "sambanova", "mistral", "groq", "agnes", "cohere"];
    const excluded = new Set([failedProvider, ...excludedProviders]);

    // Auto-expire cooled-down suspensions first
    for (const [, prov] of Object.entries(this.providers)) {
      if (prov.isSuspended && Date.now() - prov.lastFailure > prov.cooldown) {
        prov.isSuspended = false;
        prov.consecutiveErrors = 0;
      }
    }

    for (const f of fallbackList) {
      if (this.providers[f] && this.isConfigured(f) && !this.providers[f].isSuspended
        && !this.isNearLimit(f) && !excluded.has(f)) {
        return f;
      }
    }

    // Try any remaining configured provider before giving up — near-limit
    // ones are still preferable to no answer, so this widens the search
    // rather than stopping at the (possibly empty) non-near-limit set.
    const remaining = this.getAvailableProviders({ includeNearLimit: true }).filter((name) => !excluded.has(name));
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
        configured: this.isConfigured(name),
        status: !this.isConfigured(name)
          ? "unconfigured"
          : (p.isSuspended ? "suspended" : (this.isNearLimit(name) ? "near_limit" : (p.consecutiveErrors > 0 ? "degraded" : "healthy"))),
        latency: Math.round(p.latency),
        successRate: Math.round(p.successRate * 100) / 100,
      };
    }
    return stats;
  }
}

module.exports = new ProviderManager();
