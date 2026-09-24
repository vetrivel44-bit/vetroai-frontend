// Job search — finding a company's real logo.
//
// JSearch only sometimes includes an employer logo or website. When it has
// neither, the company's official logo and website are looked up on Wikidata
// (free, keyless, CORS-enabled), which covers most established employers.
// Results are cached per company for the session and in localStorage, and a
// lookup that finds nothing is cached too, so each company costs at most one
// round of requests.

const CACHE_KEY = "vsj_company_logo_v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WIKIDATA = "https://www.wikidata.org/w/api.php";

// Descriptions that mark a Wikidata item as an organisation, not a person,
// place or word that happens to share the name.
const ORG_DESCRIPTION = /\b(company|corporation|business|bank|firm|organi[sz]ation|brand|manufacturer|retailer|conglomerate|start-?up|enterprise|group|multinational|subsidiary|provider|developer|publisher|airline|insurer|consultancy|consulting|agency|hospital|university|institute|school|college|chain|platform|software|services?|technology|pharmaceutical|automaker|operator|cooperative|non-profit|nonprofit|charity|government)\b/i;

export const normalizeCompany = (name) => String(name || "")
  .toLowerCase()
  .replace(/[’'.,()&]/g, " ")
  .replace(/\b(pvt|private|ltd|limited|inc|llp|llc|corp|corporation|co|plc|gmbh|ag|sa|india|technologies|technology|services|solutions|group|holdings)\b/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const compact = (s) => normalizeCompany(s).replace(/[^a-z0-9]/g, "");

// The name to search for: legal suffixes ("Pvt Ltd", "Inc.") are dropped,
// since Wikidata labels rarely carry them, but words like "Services" stay.
export const searchTerm = (company) => String(company || "")
  .replace(/\b(pvt\.?|private|ltd\.?|limited|inc\.?|llp|llc|corp\.?|plc|gmbh)(?=\s|$|,)/gi, " ")
  .replace(/[,.]+\s*$/, "")
  .replace(/\s+/g, " ")
  .trim() || String(company || "").trim();

/** Pick the Wikidata search hit that is really this company, or null. */
export function pickCompanyHit(company, hits) {
  const want = compact(company);
  if (want.length < 2) return null;
  for (const hit of hits || []) {
    const names = [hit.label, hit.match?.text, ...(hit.aliases || [])].filter(Boolean).map(compact);
    // Exact, or one name extends the other only a little ("Infosys" / "Infosys BPM"),
    // never a short word swallowing a longer name ("Acme" / "Acmeville Foods").
    const nameMatches = names.some((n) => n === want || (
      (n.startsWith(want) || want.startsWith(n)) &&
      Math.min(n.length, want.length) >= 4 &&
      Math.min(n.length, want.length) / Math.max(n.length, want.length) >= 0.6));
    if (nameMatches && ORG_DESCRIPTION.test(hit.description || "")) return hit;
  }
  return null;
}

/** First claim value of a property on a Wikidata entity. */
function claimValue(entity, prop) {
  const claims = entity?.claims?.[prop];
  if (!Array.isArray(claims)) return null;
  const preferred = claims.find((c) => c.rank === "preferred") || claims.find((c) => c.rank !== "deprecated");
  return preferred?.mainsnak?.datavalue?.value ?? null;
}

/** Official logo (P154) as a PNG thumbnail URL, and official website (P856). */
export function logoFromEntity(entity) {
  const file = claimValue(entity, "P154");
  const website = claimValue(entity, "P856");
  return {
    logo: typeof file === "string" && file
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=128`
      : null,
    website: typeof website === "string" ? website : null,
  };
}

// ─── cache ──────────────────────────────────────────────────────────────────
const memory = new Map();
const inflight = new Map();

function readStore() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch { return {}; }
}
function writeStore(key, value) {
  try {
    const store = readStore();
    store[key] = { ...value, at: Date.now() };
    // Keep the store small: drop the oldest entries past 400.
    const keys = Object.keys(store);
    if (keys.length > 400) keys.sort((a, b) => store[a].at - store[b].at).slice(0, keys.length - 400).forEach((k) => delete store[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch { /* storage unavailable */ }
}

/** Cached result for a company without doing any lookup (undefined = unknown). */
export function cachedCompanyLogo(company) {
  const key = compact(company);
  if (!key) return null;
  if (memory.has(key)) return memory.get(key);
  const stored = readStore()[key];
  if (stored && Date.now() - stored.at < CACHE_TTL_MS) {
    const value = { logo: stored.logo || null, website: stored.website || null };
    memory.set(key, value);
    return value;
  }
  return undefined;
}

/**
 * Look a company up on Wikidata. Resolves to { logo, website } (either may
 * be null) and never rejects.
 */
export function lookupCompanyLogo(company, fetchFn = fetch) {
  const key = compact(company);
  if (!key || key.length < 2) return Promise.resolve({ logo: null, website: null });
  const cached = cachedCompanyLogo(company);
  if (cached !== undefined) return Promise.resolve(cached);
  if (inflight.has(key)) return inflight.get(key);

  const run = (async () => {
    let result = { logo: null, website: null };
    try {
      const q = new URLSearchParams({ action: "wbsearchentities", search: searchTerm(company), language: "en", type: "item", limit: "7", format: "json", origin: "*" });
      const found = await (await fetchFn(`${WIKIDATA}?${q}`)).json();
      const hit = pickCompanyHit(company, found?.search);
      if (hit?.id) {
        const g = new URLSearchParams({ action: "wbgetentities", ids: hit.id, props: "claims", format: "json", origin: "*" });
        const data = await (await fetchFn(`${WIKIDATA}?${g}`)).json();
        result = logoFromEntity(data?.entities?.[hit.id]);
      }
      memory.set(key, result);
      writeStore(key, result);
    } catch {
      // Offline or blocked: remember for this session only, try again next time.
      memory.set(key, result);
    }
    inflight.delete(key);
    return result;
  })();
  inflight.set(key, run);
  return run;
}
