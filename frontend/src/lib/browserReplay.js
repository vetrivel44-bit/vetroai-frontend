// What VetroAI Computer's live browser shows: the real searches it ran and
// the real pages it read, in order, as a list of actions to play — typing a
// search, opening a result, reading the page. Built from DeepSearch's
// activity log (`research` events) and the sources it found.

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};

/**
 * [{ type: "search", query } | { type: "visit", url, domain, title }], in the
 * order they happened, without repeats.
 */
export function browserActions({ research = null, sources = [], query = "" } = {}) {
  const actions = [];
  const seenQueries = new Set();
  const seenSites = new Set();
  const byDomain = new Map();
  for (const s of sources || []) {
    const domain = s.domain || hostOf(s.url);
    if (domain && !byDomain.has(domain)) byDomain.set(domain, { url: s.url, title: s.title, domain });
  }
  const search = (q) => {
    const text = String(q || "").trim();
    if (!text || seenQueries.has(text.toLowerCase())) return;
    seenQueries.add(text.toLowerCase());
    actions.push({ type: "search", query: text.slice(0, 120) });
  };
  const visit = (domainOrUrl) => {
    const raw = String(domainOrUrl || "").trim();
    const domain = /^https?:\/\//i.test(raw) ? hostOf(raw) : raw.replace(/^www\./, "");
    if (!domain || seenSites.has(domain)) return;
    seenSites.add(domain);
    const known = byDomain.get(domain);
    actions.push({ type: "visit", domain, url: known?.url || (/^https?:\/\//i.test(raw) ? raw : `https://${domain}`), title: known?.title || domain });
  };

  if (research?.steps?.length) {
    for (const step of research.steps) {
      const id = String(step.id || "");
      if (id.startsWith("search") || id.startsWith("verify")) (step.items || []).forEach(search);
      else if (id === "read") (step.items || []).forEach(visit);
    }
    // Pages the log doesn't list one by one still were read.
    for (const domain of byDomain.keys()) visit(domain);
  } else if (sources?.length) {
    if (query) search(query);
    for (const domain of byDomain.keys()) visit(domain);
  }
  return actions;
}

/** A picture of a web page, from a free screenshot service (the viewer falls back if it fails). */
export const screenshotUrls = (url) => [
  `https://image.thum.io/get/width/900/crop/1400/noanimate/${url}`,
  `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=900&h=1400`,
];
