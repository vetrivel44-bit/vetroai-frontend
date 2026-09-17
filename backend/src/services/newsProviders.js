// News feed providers.
//
// The panel was built against newsdata.io, whose article shape the frontend
// renders directly (`article_id`, `link`, `image_url`, `source_name`,
// `pubDate`). Other services answer the same question in their own shape, so
// each one gets a request builder and a normalizer back to that shape — the
// frontend never has to know which service answered.
const PROVIDERS = {
  // newsdata.io — the original integration. Keys are prefixed `pub_`.
  newsdata: {
    label: "newsdata.io",
    // newsdata's own category vocabulary already matches the panel's.
    categories: {
      business: "business", technology: "technology", sports: "sports",
      entertainment: "entertainment", health: "health", science: "science",
      politics: "politics",
    },
    buildRequest({ apiKey, query, category, language }) {
      const params = new URLSearchParams({ apikey: apiKey, language });
      if (query) params.set("q", query);
      else if (category) params.set("category", category);
      return { url: `https://newsdata.io/api/1/latest?${params}`, headers: {} };
    },
    // Already the shape the frontend wants.
    normalize: (payload) => (Array.isArray(payload?.results) ? payload.results : []),
  },

  // thenewsapi.com — 40-character alphanumeric tokens.
  thenewsapi: {
    label: "thenewsapi.com",
    // "technology" and "top" are spelled differently here, and a top-headline
    // request simply omits the category.
    categories: {
      business: "business", technology: "tech", sports: "sports",
      entertainment: "entertainment", health: "health", science: "science",
      politics: "politics",
    },
    buildRequest({ apiKey, query, category, language, limit }) {
      const params = new URLSearchParams({ api_token: apiKey, language });
      // `limit` is plan-capped (3 on the free tier) and a request over the cap
      // is rejected outright, so it is only sent when explicitly configured.
      if (limit) params.set("limit", String(limit));
      if (query) {
        params.set("search", query);
        return { url: `https://api.thenewsapi.com/v1/news/all?${params}`, headers: {} };
      }
      if (category) params.set("categories", category);
      return { url: `https://api.thenewsapi.com/v1/news/top?${params}`, headers: {} };
    },
    normalize: (payload) => (Array.isArray(payload?.data) ? payload.data : []).map((item) => ({
      article_id: item.uuid || item.url || null,
      title: item.title || "",
      description: item.description || item.snippet || "",
      link: item.url || "",
      image_url: item.image_url || null,
      source_name: item.source || "",
      source_id: item.source || "",
      source_icon: null,
      // Already ISO-8601 with a zone, which the panel's timeAgo() handles.
      pubDate: item.published_at || null,
    })),
  },

  // newsapi.org — keys are 32 hex characters. No politics category, so a
  // politics request falls back to general headlines.
  newsapi: {
    label: "newsapi.org",
    categories: {
      business: "business", technology: "technology", sports: "sports",
      entertainment: "entertainment", health: "health", science: "science",
    },
    buildRequest({ apiKey, query, category, language }) {
      const params = new URLSearchParams({ language });
      if (query) {
        params.set("q", query);
        return {
          url: `https://newsapi.org/v2/everything?${params}`,
          headers: { "X-Api-Key": apiKey },
        };
      }
      if (category) params.set("category", category);
      return {
        url: `https://newsapi.org/v2/top-headlines?${params}`,
        headers: { "X-Api-Key": apiKey },
      };
    },
    normalize: (payload) => (Array.isArray(payload?.articles) ? payload.articles : []).map((item) => ({
      article_id: item.url || null,
      title: item.title || "",
      description: item.description || "",
      link: item.url || "",
      image_url: item.urlToImage || null,
      source_name: item.source?.name || "",
      source_id: item.source?.id || item.source?.name || "",
      source_icon: null,
      pubDate: item.publishedAt || null,
    })),
  },
};

// Works out which service a key belongs to from its shape, so an existing
// deployment keeps working after this change without setting anything new.
// An explicit NEWS_PROVIDER always wins — detection is a fallback, not a rule.
function detectNewsProvider(apiKey, explicit = "") {
  const named = String(explicit || "").trim().toLowerCase();
  if (named && PROVIDERS[named]) return named;
  const key = String(apiKey || "").trim();
  if (!key) return null;
  if (key.startsWith("pub_")) return "newsdata";
  if (/^[0-9a-f]{32}$/i.test(key)) return "newsapi";
  return "thenewsapi";
}

// Translates the panel's category into the provider's own vocabulary. "top"
// means "no category filter" everywhere, and a category a provider does not
// have is dropped rather than sent and rejected.
function resolveCategory(provider, category) {
  const name = String(category || "top").toLowerCase();
  if (name === "top") return "";
  return PROVIDERS[provider]?.categories[name] || "";
}

function buildNewsRequest(provider, params) {
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error(`Unknown news provider: ${provider}`);
  return definition.buildRequest({
    ...params,
    category: resolveCategory(provider, params.category),
  });
}

function normalizeNewsPayload(provider, payload) {
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error(`Unknown news provider: ${provider}`);
  return definition.normalize(payload);
}

function providerLabel(provider) {
  return PROVIDERS[provider]?.label || provider || "unknown";
}

module.exports = {
  PROVIDERS,
  detectNewsProvider,
  resolveCategory,
  buildNewsRequest,
  normalizeNewsPayload,
  providerLabel,
};
