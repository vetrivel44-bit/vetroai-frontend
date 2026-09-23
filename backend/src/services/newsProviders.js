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

// How far back a feed request looks. Top-headline endpoints are already
// current; this bounds the search / "everything" endpoints, which otherwise
// happily return articles from weeks ago.
const RECENT_DAYS = 3;
// "2026-09-20T13:00:00" (UTC, no zone) — the form thenewsapi and newsapi accept.
const sinceIso = (now = Date.now(), days = RECENT_DAYS) => new Date(now - days * 86400000).toISOString().slice(0, 19);


// Firecrawl dates news the way a search results page does: "3 hours ago",
// "1 day ago", or "Sep 22, 2026". Turned into ISO so the panel can say
// "3h" and the feed can sort newest first.
function relativeToIso(value, now = Date.now()) {
  const text = String(value || "").trim();
  if (!text) return null;
  const rel = /^(\d+)\s*(sec|second|min|minute|hr|hour|day|week|month)s?\s+ago$/i.exec(text);
  if (rel) {
    const unit = { sec: 1, second: 1, min: 60, minute: 60, hr: 3600, hour: 3600, day: 86400, week: 604800, month: 2592000 }[rel[2].toLowerCase()];
    return new Date(now - Number(rel[1]) * unit * 1000).toISOString();
  }
  if (/^(just now|now)$/i.test(text)) return new Date(now).toISOString();
  if (/^yesterday$/i.test(text)) return new Date(now - 86400000).toISOString();
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// Firecrawl has no page cursor, so page N asks for the first N×20 results
// (Firecrawl's cap is 100) and keeps the newest 20.
const FIRECRAWL_PAGE_SIZE = 20;
const FIRECRAWL_MAX_RESULTS = 100;
const FIRECRAWL_QUERIES = {
  "": "top news today",
  business: "business news",
  technology: "technology news",
  sports: "sports news",
  entertainment: "entertainment news",
  health: "health news",
  science: "science news",
  politics: "politics news",
};

const PROVIDERS = {
  // firecrawl.dev — keys are prefixed `fc-`. A web search with news as the
  // source rather than a news feed, so each category is a search query and
  // the request is a JSON POST.
  firecrawl: {
    label: "Firecrawl",
    categories: {
      business: "business", technology: "technology", sports: "sports",
      entertainment: "entertainment", health: "health", science: "science",
      politics: "politics",
    },
    buildRequest({ apiKey, query, category, page }) {
      const pageNo = Math.max(1, Number(page) || 1);
      const body = {
        query: query || FIRECRAWL_QUERIES[category] || FIRECRAWL_QUERIES[""],
        sources: ["news"],
        limit: Math.min(pageNo * FIRECRAWL_PAGE_SIZE, FIRECRAWL_MAX_RESULTS),
        // Past day for the feed; a search may look back a week.
        tbs: query ? "qdr:w" : "qdr:d",
      };
      return {
        url: "https://api.firecrawl.dev/v2/search",
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
    },
    nextPage: (payload, page) => {
      const pageNo = Math.max(1, Number(page) || 1);
      const count = (payload?.data?.news || []).length;
      const asked = Math.min(pageNo * FIRECRAWL_PAGE_SIZE, FIRECRAWL_MAX_RESULTS);
      return count >= asked && asked < FIRECRAWL_MAX_RESULTS ? String(pageNo + 1) : null;
    },
    normalize: (payload, page) => {
      const pageNo = Math.max(1, Number(page) || 1);
      const items = Array.isArray(payload?.data?.news) ? payload.data.news : [];
      return items.slice((pageNo - 1) * FIRECRAWL_PAGE_SIZE).map((item) => ({
        article_id: item.url || null,
        title: item.title || "",
        description: item.snippet || item.description || "",
        link: item.url || "",
        // Firecrawl's picture is the search result's small thumbnail (and
        // sometimes an inline data: one), blurry when stretched over a card.
        // It's kept aside; the article's own full-size og:image is looked up
        // first, and the thumbnail is only a stopgap (see latestNews).
        image_url: null,
        thumbnail_url: /^https?:\/\//i.test(item.imageUrl || "") ? item.imageUrl : null,
        source_name: item.source || hostOf(item.url),
        source_id: hostOf(item.url),
        source_icon: null,
        pubDate: relativeToIso(item.date),
      }));
    },
  },

  // newsdata.io — the original integration. Keys are prefixed `pub_`.
  newsdata: {
    label: "newsdata.io",
    // newsdata's own category vocabulary already matches the panel's.
    categories: {
      business: "business", technology: "technology", sports: "sports",
      entertainment: "entertainment", health: "health", science: "science",
      politics: "politics",
    },
    buildRequest({ apiKey, query, category, language, page }) {
      const params = new URLSearchParams({ apikey: apiKey, language });
      if (query) params.set("q", query);
      else if (category) params.set("category", category);
      // newsdata pages with an opaque cursor it returns as `nextPage`.
      if (page) params.set("page", page);
      return { url: `https://newsdata.io/api/1/latest?${params}`, headers: {} };
    },
    nextPage: (payload) => (payload?.nextPage ? String(payload.nextPage) : null),
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
    buildRequest({ apiKey, query, category, language, limit, page, now }) {
      const params = new URLSearchParams({ api_token: apiKey, language });
      if (page) params.set("page", page);
      params.set("published_after", sinceIso(now));
      // `limit` is plan-capped (3 on the free tier) and a request over the cap
      // is rejected outright, so it is only sent when explicitly configured.
      if (limit) params.set("limit", String(limit));
      if (query) {
        params.set("search", query);
        params.set("sort", "published_at");
        return { url: `https://api.thenewsapi.com/v1/news/all?${params}`, headers: {} };
      }
      if (category) params.set("categories", category);
      return { url: `https://api.thenewsapi.com/v1/news/top?${params}`, headers: {} };
    },
    nextPage: (payload, page) => {
      const meta = payload?.meta || {};
      const current = Number(meta.page || page || 1);
      const returned = Number(meta.returned ?? (payload?.data || []).length);
      const found = Number(meta.found || 0);
      const perPage = Number(meta.limit || returned || 1);
      return returned > 0 && current * perPage < found ? String(current + 1) : null;
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
    buildRequest({ apiKey, query, category, language, page, now }) {
      const params = new URLSearchParams({ language, pageSize: "20" });
      if (page) params.set("page", page);
      if (query) {
        params.set("q", query);
        // /everything defaults to relevance over all time; ask for the newest.
        params.set("sortBy", "publishedAt");
        params.set("from", sinceIso(now));
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
    nextPage: (payload, page) => {
      const current = Number(page || 1);
      const count = (payload?.articles || []).length;
      return count > 0 && current * 20 < Number(payload?.totalResults || 0) ? String(current + 1) : null;
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
    buildRequest({ apiKey, query, category, language, limit, page, now }) {
      const params = new URLSearchParams({ language });
      if (category) params.set("category", category);
      if (page) params.set("page_number", page);
      // Plan-capped like thenewsapi's, so only sent when configured.
      if (limit) params.set("page_size", String(limit));
      // Search and latest are separate endpoints; `keywords` is the search term.
      const path = query ? "search" : "latest-news";
      if (query) {
        params.set("keywords", query);
        params.set("start_date", `${sinceIso(now)}+00:00`);
      }
      return {
        // The docs show "Authorization: Bearer <token>". Older ones showed the
        // bare token, and which one the service enforces is not something we
        // can tell from here — `authFallback` below covers the other form.
        url: `https://api.currentsapi.services/v1/${path}?${params}`,
        headers: { Authorization: `Bearer ${apiKey}` },
      };
    },
    // Currents reports no total, so keep paging while pages come back full-ish
    // (capped, since its free tier serves the same recent window).
    nextPage: (payload, page) => {
      const current = Number(page || 1);
      return (payload?.news || []).length > 0 && current < 10 ? String(current + 1) : null;
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
  if (key.startsWith("fc-")) return "firecrawl";
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

function normalizeNewsPayload(provider, payload, page) {
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error(`Unknown news provider: ${provider}`);
  return definition.normalize(payload, page);
}

// Newest first. Providers mostly do this already, but not reliably (search
// endpoints sort by relevance), and an undated article sinks to the bottom.
function sortNewestFirst(articles) {
  const time = (a) => {
    const text = String(a?.pubDate || "");
    if (!text) return 0;
    const iso = /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  return [...articles].sort((a, b) => time(b) - time(a));
}

// ─── Duplicate stories ───────────────────────────────────────────────────
// Feeds repeat a story under different ids and links: syndicated copies, AMP
// and tracking-tagged URLs, and headlines carrying the outlet's name
// ("… - The Hindu") or lightly reworded. Two articles are the same story when
// their cleaned link or cleaned headline match, or their headlines share
// nearly all their meaningful words. Images are not compared — many outlets
// use one default picture for every article.
const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|mc_[a-z]+|ref|ref_src|cmpid|ito|ncid|taid|output[Tt]ype|amp)$/i;
const STOP_WORDS = new Set("the a an and or of to in on for with at by from as is are was were be been it its this that these those after over into than about amid says said new".split(" "));

function linkKey(url) {
  try {
    const u = new URL(String(url));
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    const path = u.pathname.replace(/\/amp\/?$/i, "/").replace(/\.amp(\.html?)?$/i, "$1").replace(/\/+$/, "");
    return `${u.hostname.replace(/^(www|m|amp)\./, "")}${path}${u.search}`.toLowerCase();
  } catch {
    return "";
  }
}

function headlineKey(title) {
  let text = String(title || "").toLowerCase().trim();
  // Drop a trailing " - Outlet" / " | Outlet" / " — Outlet" (short tails only).
  text = text.replace(/\s+[-|–—:]\s+[^-|–—:]{2,60}$/u, (tail) => (tail.trim().split(/\s+/).length <= 7 ? "" : tail));
  return text.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// Light stemming so "beats"/"beat" and "wickets"/"wicket" count as the same word.
const stem = (w) => (w.length > 4 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);

function headlineWords(key) {
  return new Set(key.split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w)).map(stem));
}

function similarHeadlines(a, b) {
  if (a.size < 4 || b.size < 4) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared) >= 0.75;
}

// Keeps the first copy of each story (callers sort newest first), borrowing
// a picture from a later copy when the kept one has none.
function dedupeArticles(articles) {
  const kept = [];
  const byLink = new Map();
  const byHeadline = new Map();
  for (const article of articles || []) {
    if (!article || article.duplicate === true) continue; // newsdata's own flag
    const link = linkKey(article.link);
    const headline = headlineKey(article.title);
    const words = headlineWords(headline);
    const match = (link && byLink.get(link))
      || (headline && byHeadline.get(headline))
      || kept.find((k) => similarHeadlines(k.words, words));
    if (match) {
      if (!match.article.image_url && article.image_url) match.article.image_url = article.image_url;
      continue;
    }
    const entry = { article, words };
    kept.push(entry);
    if (link) byLink.set(link, entry);
    if (headline) byHeadline.set(headline, entry);
  }
  return kept.map((entry) => entry.article);
}

// The cursor for the page after this one, or null when the provider has no
// more. Always a string, since newsdata's is opaque and the others' numeric.
function nextNewsPage(provider, payload, page) {
  const definition = PROVIDERS[provider];
  return definition?.nextPage ? definition.nextPage(payload, page) : null;
}

function providerLabel(provider) {
  return PROVIDERS[provider]?.label || provider || "unknown";
}

module.exports = {
  PROVIDERS,
  toIsoDate,
  relativeToIso,
  detectNewsProvider,
  resolveCategory,
  buildNewsRequest,
  buildNewsAuthFallback,
  normalizeNewsPayload,
  nextNewsPage,
  sortNewestFirst,
  dedupeArticles,
  linkKey,
  headlineKey,
  providerLabel,
};
