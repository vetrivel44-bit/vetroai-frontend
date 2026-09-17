// News feed providers.
//
// The panel was built against newsdata.io, whose article shape the frontend
// renders directly (`article_id`, `link`, `image_url`, `source_name`,
// `pubDate`). Other services answer the same question in their own shape, so
// each one gets a request builder and a normalizer back to that shape — the
// frontend never has to know which service answered.
// The panel's timeAgo() only understands a trailing "Z" or a bare
// "YYYY-MM-DD HH:MM:SS". Currents sends "2026-09-17 12:00:00 +0000", which
// becomes "2026-09-17T12:00:00 +0000Z" there — an invalid Date, rendered as
// "NaNm" on every card. Anything with an offset is converted to ISO here.
function toIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  // "2026-09-17 12:00:00 +0000" / "+05:30" → replace the date/time space only.
  const offsetForm = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/);
  if (offsetForm) {
    const [, date, time, offsetHours, offsetMinutes] = offsetForm;
    const parsed = new Date(`${date}T${time}${offsetHours}:${offsetMinutes}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  // Already ISO with a zone, or the bare form the panel handles itself.
  return text;
}

// Currents reports a missing image as the literal string "None", which would
// render as a broken <img> the panel then hides.
// Currents has no source-name field, so the outlet is read off the link.
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanImageUrl(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "none" || text.toLowerCase() === "null") return null;
  return text;
}

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

  // currentsapi.services — 48-character tokens. Its category vocabulary
  // already matches the panel's one-for-one.
  currents: {
    label: "currentsapi.services",
    categories: {
      business: "business", technology: "technology", sports: "sports",
      entertainment: "entertainment", health: "health", science: "science",
      politics: "politics",
    },
    buildRequest({ apiKey, query, category, language, limit }) {
      const params = new URLSearchParams({ language });
      if (category) params.set("category", category);
      // Plan-capped like thenewsapi's, so only sent when configured.
      if (limit) params.set("page_size", String(limit));
      // Search and latest are separate endpoints; `keywords` is the search term.
      const path = query ? "search" : "latest-news";
      if (query) params.set("keywords", query);
      return {
        // The docs show "Authorization: Bearer <token>". Older ones showed the
        // bare token, and which one the service enforces is not something we
        // can tell from here — `authFallback` below covers the other form.
        url: `https://api.currentsapi.services/v1/${path}?${params}`,
        headers: { Authorization: `Bearer ${apiKey}` },
      };
    },
    // Retried once, and only after the first form is rejected as unauthorized.
    // Currents accepts the token as an `apiKey` query parameter as well, which
    // works whichever header convention the service is on.
    authFallback({ apiKey }, request) {
      const url = new URL(request.url);
      url.searchParams.set("apiKey", apiKey);
      return { url: url.toString(), headers: {} };
    },
    normalize: (payload) => (Array.isArray(payload?.news) ? payload.news : []).map((item) => ({
      article_id: item.id || item.url || null,
      title: item.title || "",
      description: item.description || "",
      link: item.url || "",
      image_url: cleanImageUrl(item.image),
      // Currents names the outlet nowhere but the article URL's host.
      source_name: hostOf(item.url),
      source_id: hostOf(item.url),
      source_icon: null,
      pubDate: toIsoDate(item.published),
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
  // thenewsapi issues 40-character tokens, Currents longer ones. The two are
  // only told apart by length, so NEWS_PROVIDER exists for when that is wrong.
  if (/^[A-Za-z0-9_-]{44,}$/.test(key)) return "currents";
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

// The second form to try when the first is rejected as unauthorized, or null
// when a provider has only one way to authenticate.
function buildNewsAuthFallback(provider, params, request) {
  const definition = PROVIDERS[provider];
  if (!definition?.authFallback) return null;
  return definition.authFallback(params, request);
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
  toIsoDate,
  detectNewsProvider,
  resolveCategory,
  buildNewsRequest,
  buildNewsAuthFallback,
  normalizeNewsPayload,
  providerLabel,
};
