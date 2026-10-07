import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, BadgePercent, Clock, Footprints, Headphones, History, Laptop, Loader2,
  PackageSearch, RefreshCw, Search, ShieldCheck, ShoppingBag, Smartphone, Sparkles, Star,
  Store, Tag, TrendingDown, Trophy, Tv, Watch, X,
} from "lucide-react";
import { resolveApiBase } from "../../lib/apiBase";
import "./DealsHub.css";

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const API = resolveApiBase(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD, PROD_API);
const HOUR_MS = 60 * 60 * 1000;
const RECENT_KEY = "vetroai_deals_recent_v1";
const REGION_KEY = "vetroai_deals_region_v1";

const REGIONS = [
  { id: "in", label: "India", flag: "🇮🇳", locale: "en-IN", currency: "INR" },
  { id: "us", label: "USA", flag: "🇺🇸", locale: "en-US", currency: "USD" },
];

const CATEGORIES = [
  { query: "smartphones", label: "Smartphones", icon: Smartphone },
  { query: "laptops", label: "Laptops", icon: Laptop },
  { query: "wireless earbuds", label: "Earbuds", icon: Headphones },
  { query: "smartwatch", label: "Smartwatches", icon: Watch },
  { query: "smart tv", label: "Smart TVs", icon: Tv },
  { query: "running shoes", label: "Shoes", icon: Footprints },
];

const SORTS = [
  { id: "price", label: "Lowest price" },
  { id: "discount", label: "Biggest discount" },
  { id: "rating", label: "Top rated" },
  { id: "history", label: "Closest to all-time low" },
];

function readStorage(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function formatPrice(value, region) {
  if (value == null) return "—";
  const r = REGIONS.find((x) => x.id === region) || REGIONS[0];
  return new Intl.NumberFormat(r.locale, {
    style: "currency", currency: r.currency, maximumFractionDigits: value % 1 ? 2 : 0,
  }).format(value);
}

function timeAgo(iso, now) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function timeUntil(ms) {
  const mins = Math.max(0, Math.ceil(ms / 60000));
  return mins >= 60 ? "1 hr" : `${mins} min`;
}

function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(body?.message || `Request failed (${res.status})`);
  return body.data;
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Sparkline({ points, width = 120, height = 32 }) {
  if (!points || points.length < 2) return null;
  const values = points.map((p) => p.p);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xy = values.map((v, i) => [
    (i / (values.length - 1)) * (width - 4) + 2,
    height - 4 - ((v - min) / span) * (height - 8),
  ]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const lowIdx = values.lastIndexOf(min);
  const [lx, ly] = xy[lowIdx];
  const [ex, ey] = xy[xy.length - 1];
  return (
    <svg className="dh-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`${d} L${ex},${height} L2,${height} Z`} className="dh-spark-fill" />
      <path d={d} className="dh-spark-line" />
      <circle cx={lx} cy={ly} r="3" className="dh-spark-low" />
      <circle cx={ex} cy={ey} r="2.5" className="dh-spark-now" />
    </svg>
  );
}

function StoreBadge({ item }) {
  return (
    <span className="dh-store" style={{ "--store": item.storeColor || "var(--dh-accent)" }}>
      <span className="dh-store-dot" />{item.store}
    </span>
  );
}

function ProductImage({ item }) {
  const [failed, setFailed] = useState(false);
  if (item.image && !failed) {
    return <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return (
    <div className="dh-img-fallback" style={{ "--store": item.storeColor || "var(--dh-accent)" }}>
      <ShoppingBag size={30} strokeWidth={1.5} />
      <span>{item.store}</span>
    </div>
  );
}

function HistoryLine({ item, region }) {
  const h = item.history;
  if (!h) return <div className="dh-hist dh-hist-new"><History size={12} /> Tracking starts now</div>;
  if (h.isLowest) {
    return (
      <div className="dh-hist dh-hist-low">
        <TrendingDown size={12} /> Lowest price ever{h.checks > 1 ? ` · ${h.checks} checks` : ""}
      </div>
    );
  }
  return (
    <div className="dh-hist">
      <History size={12} /> Lowest {formatPrice(h.lowestPrice, region)} on {shortDate(h.lowestAt)}
    </div>
  );
}

function ProductCard({ item, region, cheapest }) {
  return (
    <a className={`dh-card${cheapest ? " is-cheapest" : ""}`} href={item.url} target="_blank" rel="noopener noreferrer nofollow">
      {cheapest && <span className="dh-ribbon"><Trophy size={12} /> Cheapest</span>}
      {item.discountPct ? <span className="dh-off">-{item.discountPct}%</span> : null}
      <div className="dh-card-img"><ProductImage item={item} /></div>
      <div className="dh-card-body">
        <StoreBadge item={item} />
        <h3 className="dh-card-title" title={item.title}>{item.title}</h3>
        <div className="dh-price-row">
          <span className="dh-price">{formatPrice(item.price, region)}</span>
          {item.originalPrice ? <span className="dh-mrp">{formatPrice(item.originalPrice, region)}</span> : null}
        </div>
        {item.rating ? (
          <div className="dh-rating">
            <Star size={12} fill="currentColor" /> {item.rating.toFixed(1)}
            {item.reviews ? <span>({item.reviews.toLocaleString()})</span> : null}
          </div>
        ) : null}
        <HistoryLine item={item} region={region} />
      </div>
      <div className="dh-card-cta">View on {item.store} <ArrowUpRight size={14} /></div>
    </a>
  );
}

function SkeletonGrid({ count = 8 }) {
  return (
    <div className="dh-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="dh-card dh-skel">
          <div className="dh-card-img dh-shimmer" />
          <div className="dh-card-body">
            <div className="dh-shimmer dh-skel-line" style={{ width: "40%" }} />
            <div className="dh-shimmer dh-skel-line" />
            <div className="dh-shimmer dh-skel-line" style={{ width: "70%" }} />
            <div className="dh-shimmer dh-skel-line dh-skel-price" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Spotlight({ data, best }) {
  const { region } = data;
  const prices = data.items.map((i) => i.price);
  const max = Math.max(...prices);
  const saving = max - best.price;
  const h = best.history;
  const qh = data.history;
  return (
    <section className="dh-spotlight">
      <div className="dh-spot-img"><ProductImage item={best} /></div>
      <div className="dh-spot-main">
        <div className="dh-spot-kicker"><Sparkles size={14} /> Best price right now</div>
        <h2 className="dh-spot-title">{best.title}</h2>
        <div className="dh-spot-meta">
          <StoreBadge item={best} />
          {best.rating ? <span className="dh-rating"><Star size={12} fill="currentColor" /> {best.rating.toFixed(1)}</span> : null}
          {best.delivery ? <span className="dh-muted">{best.delivery}</span> : null}
        </div>
        <div className="dh-spot-price-row">
          <span className="dh-spot-price">{formatPrice(best.price, region)}</span>
          {best.originalPrice ? <span className="dh-mrp">{formatPrice(best.originalPrice, region)}</span> : null}
          {best.discountPct ? <span className="dh-pill-off">{best.discountPct}% off</span> : null}
        </div>
        {saving > 0 && data.items.length > 1 && (
          <p className="dh-spot-save">
            Save up to <strong>{formatPrice(saving, region)}</strong> vs. the priciest of {data.items.length} offers found.
          </p>
        )}
        <a className="dh-btn-primary" href={best.url} target="_blank" rel="noopener noreferrer nofollow">
          Go to {best.store} <ArrowUpRight size={16} />
        </a>
      </div>
      <div className="dh-spot-history">
        <div className="dh-hist-head"><History size={14} /> Price history</div>
        {h ? (
          <>
            <div className="dh-hist-stat">
              <span>All-time low</span>
              <strong className={h.isLowest ? "is-good" : ""}>{formatPrice(h.lowestPrice, region)}</strong>
              <em>{shortDate(h.lowestAt)}</em>
            </div>
            {h.highestPrice != null && (
              <div className="dh-hist-stat">
                <span>Highest</span>
                <strong>{formatPrice(h.highestPrice, region)}</strong>
              </div>
            )}
            <Sparkline points={h.points} width={200} height={54} />
            <p className={`dh-verdict${h.isLowest ? " is-good" : ""}`}>
              {h.isLowest
                ? (h.checks > 1 ? "Today's price is the lowest we've recorded — a good time to buy." : "First check for this product — tracking hourly from now.")
                : `${formatPrice(h.aboveLowestBy, region)} above its lowest recorded price.`}
            </p>
          </>
        ) : (
          <p className="dh-muted">Tracking starts with this check — prices are re-checked every hour.</p>
        )}
        {qh && qh.lowestPrice < best.price && (
          <p className="dh-hist-query">
            Cheapest ever seen for “{data.query}”: <strong>{formatPrice(qh.lowestPrice, region)}</strong> on {shortDate(qh.lowestAt)}
          </p>
        )}
      </div>
    </section>
  );
}

function PriceSpread({ data }) {
  const byStore = useMemo(() => {
    const m = new Map();
    for (const it of data.items) {
      const cur = m.get(it.storeId);
      if (!cur || it.price < cur.price) m.set(it.storeId, it);
    }
    return [...m.values()].sort((a, b) => a.price - b.price);
  }, [data.items]);
  if (byStore.length < 2) return null;
  const max = byStore[byStore.length - 1].price;
  return (
    <section className="dh-spread">
      <div className="dh-section-head"><Store size={15} /> Lowest price by store</div>
      <div className="dh-spread-rows">
        {byStore.map((it, i) => (
          <a key={it.storeId} className="dh-spread-row" href={it.url} target="_blank" rel="noopener noreferrer nofollow">
            <span className="dh-spread-name">{it.store}</span>
            <span className="dh-spread-bar">
              <span style={{ width: `${Math.max(8, (it.price / max) * 100)}%`, background: it.storeColor || "var(--dh-accent)" }} />
            </span>
            <span className={`dh-spread-price${i === 0 ? " is-good" : ""}`}>{formatPrice(it.price, data.region)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function StoreLinks({ links, query }) {
  if (!links?.length) return null;
  return (
    <section className="dh-links">
      <div className="dh-section-head"><ShoppingBag size={15} /> Check “{query}” directly on</div>
      <div className="dh-links-row">
        {links.map((s) => (
          <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="dh-link-chip" style={{ "--store": s.color }}>
            <span className="dh-store-dot" />{s.name}<ArrowUpRight size={13} />
          </a>
        ))}
      </div>
    </section>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function DealsHub({ onClose }) {
  const [region, setRegion] = useState(() => readStorage(REGION_KEY, "in"));
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [featured, setFeatured] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [sort, setSort] = useState("price");
  const [recent, setRecent] = useState(() => readStorage(RECENT_KEY, []));
  const [now, setNow] = useState(Date.now());
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const reqId = useRef(0);
  const inputRef = useRef(null);

  const load = useCallback(async (q, r, { silent = false } = {}) => {
    const id = ++reqId.current;
    if (!silent) { setLoading(true); setError(""); }
    try {
      if (q) {
        const d = await getJson(`/deals/search?q=${encodeURIComponent(q)}&region=${r}`);
        if (id !== reqId.current) return;
        setData(d);
      } else {
        const d = await getJson(`/deals/featured?region=${r}`);
        if (id !== reqId.current) return;
        setFeatured(d);
      }
      setLastLoadedAt(Date.now());
      setError("");
    } catch (err) {
      if (id !== reqId.current) return;
      if (!silent) setError(err.message || "Couldn't load deals.");
    } finally {
      if (id === reqId.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(query, region); }, [query, region, load]);
  useEffect(() => { writeStorage(REGION_KEY, region); }, [region]);

  // Prices are re-checked hourly on the server; the open screen pulls the
  // fresh numbers on the same cadence, and the clock keeps "updated X ago" live.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!lastLoadedAt) return undefined;
    const t = setTimeout(() => load(query, region, { silent: true }), HOUR_MS);
    return () => clearTimeout(t);
  }, [lastLoadedAt, query, region, load]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && document.activeElement !== inputRef.current) onClose?.();
      if (e.key === "/" && document.activeElement !== inputRef.current) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runSearch = (q) => {
    const clean = String(q || "").trim();
    setInput(clean);
    setStoreFilter("all");
    setSort("price");
    if (!clean) { setQuery(""); setData(null); return; }
    setData(null);
    setQuery(clean);
    const next = [clean, ...recent.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 8);
    setRecent(next);
    writeStorage(RECENT_KEY, next);
  };

  const stores = useMemo(() => {
    if (!data?.items) return [];
    const m = new Map();
    for (const it of data.items) m.set(it.storeId, { id: it.storeId, name: it.store, color: it.storeColor, count: (m.get(it.storeId)?.count || 0) + 1 });
    return [...m.values()];
  }, [data]);

  const visible = useMemo(() => {
    if (!data?.items) return [];
    const list = data.items.filter((i) => storeFilter === "all" || i.storeId === storeFilter);
    const by = {
      price: (a, b) => a.price - b.price,
      discount: (a, b) => (b.discountPct || 0) - (a.discountPct || 0) || a.price - b.price,
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.price - b.price,
      history: (a, b) => (a.history?.aboveLowestBy ?? Infinity) - (b.history?.aboveLowestBy ?? Infinity) || a.price - b.price,
    }[sort];
    return [...list].sort(by);
  }, [data, storeFilter, sort]);

  const cheapestId = data?.items?.[0]?.id;
  const fetchedAt = query ? data?.fetchedAt : featured?.sections?.find((s) => s.fetchedAt)?.fetchedAt;
  const nextIn = lastLoadedAt ? lastLoadedAt + HOUR_MS - now : HOUR_MS;

  return (
    <div className="deals-hub" role="dialog" aria-label="VetroAI Deals">
      <header className="dh-header">
        <button type="button" className="dh-icon-btn" onClick={onClose} title="Back to chat"><ArrowLeft size={18} /></button>
        <div className="dh-brand">
          <span className="dh-logo"><Tag size={17} /></span>
          <div>
            <div className="dh-brand-name">VetroAI Deals</div>
            <div className="dh-brand-sub">Cheapest prices across Amazon, Flipkart &amp; more</div>
          </div>
        </div>
        <div className="dh-header-right">
          <div className="dh-live" title={`Prices are re-checked every hour. Next update in ${timeUntil(nextIn)}.`}>
            <span className="dh-live-dot" />
            <span className="dh-live-text">{fetchedAt ? `Updated ${timeAgo(fetchedAt, now)}` : "Live prices"}</span>
            <span className="dh-live-next"><Clock size={12} /> next in {timeUntil(nextIn)}</span>
          </div>
          <button type="button" className="dh-icon-btn" onClick={() => load(query, region)} title="Refresh now" disabled={loading}>
            <RefreshCw size={16} className={loading ? "dh-spin" : ""} />
          </button>
          <div className="dh-region" role="group" aria-label="Region">
            {REGIONS.map((r) => (
              <button key={r.id} type="button" className={region === r.id ? "on" : ""} onClick={() => { setRegion(r.id); setData(null); setFeatured(null); }}>
                <span aria-hidden="true">{r.flag}</span> {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="dh-scroll">
        <section className="dh-hero">
          <h1>Find the <span>lowest price</span>, every hour.</h1>
          <p>VetroAI compares live offers across shopping sites, tracks price history and points you to the cheapest store.</p>
          <form className="dh-search" onSubmit={(e) => { e.preventDefault(); runSearch(input); }}>
            <Search size={19} className="dh-search-icon" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search a product — e.g. iPhone 16, Sony WH-1000XM5, Nike Pegasus"
              aria-label="Search products"
              maxLength={120}
            />
            {input && <button type="button" className="dh-clear" onClick={() => runSearch("")} title="Clear"><X size={16} /></button>}
            <button type="submit" className="dh-search-btn" disabled={!input.trim() || loading}>
              {loading && query ? <Loader2 size={16} className="dh-spin" /> : "Compare prices"}
            </button>
          </form>
          <div className="dh-chips">
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              return (
                <button key={c.query} type="button" className={`dh-chip${query === c.query ? " on" : ""}`} onClick={() => runSearch(c.query)}>
                  <Icon size={14} /> {c.label}
                </button>
              );
            })}
          </div>
          {recent.length > 0 && (
            <div className="dh-recent">
              <span>Recent:</span>
              {recent.map((r) => <button key={r} type="button" onClick={() => runSearch(r)}>{r}</button>)}
              <button type="button" className="dh-recent-clear" onClick={() => { setRecent([]); writeStorage(RECENT_KEY, []); }}>Clear</button>
            </div>
          )}
          <div className="dh-trust">
            <span><ShieldCheck size={14} /> Direct store links — no sign-up</span>
            <span><RefreshCw size={14} /> Re-checked every hour</span>
            <span><History size={14} /> Lowest-ever price tracking</span>
          </div>
        </section>

        {error && (
          <div className="dh-error">
            <span>{error}</span>
            <button type="button" onClick={() => load(query, region)}>Try again</button>
          </div>
        )}

        {query ? (
          <>
            {loading && !data && <SkeletonGrid />}
            {data && data.items.length > 0 && (
              <>
                <Spotlight data={data} best={data.items[0]} />
                <PriceSpread data={data} />
                <div className="dh-toolbar">
                  <div className="dh-results-count">
                    <strong>{visible.length}</strong> offers for “{data.query}”
                    {data.stale && <span className="dh-stale"> · showing last good prices</span>}
                  </div>
                  <div className="dh-filters">
                    <button type="button" className={`dh-filter${storeFilter === "all" ? " on" : ""}`} onClick={() => setStoreFilter("all")}>All stores</button>
                    {stores.map((s) => (
                      <button key={s.id} type="button" className={`dh-filter${storeFilter === s.id ? " on" : ""}`} style={{ "--store": s.color || "var(--dh-accent)" }} onClick={() => setStoreFilter(s.id)}>
                        <span className="dh-store-dot" />{s.name} <em>{s.count}</em>
                      </button>
                    ))}
                    <label className="dh-sort">
                      <BadgePercent size={14} />
                      <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort offers">
                        {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="dh-grid">
                  {visible.map((item) => <ProductCard key={item.id} item={item} region={data.region} cheapest={item.id === cheapestId} />)}
                </div>
              </>
            )}
            {data && data.items.length === 0 && !loading && (
              <div className="dh-empty">
                <PackageSearch size={40} strokeWidth={1.4} />
                <h3>No priced offers found for “{data.query}”</h3>
                <p>Try a more specific product name or model number — or open the stores below directly.</p>
              </div>
            )}
            {data && <StoreLinks links={data.storeLinks} query={data.query} />}
          </>
        ) : (
          <>
            {loading && !featured && CATEGORIES.slice(0, 2).map((c) => (
              <section key={c.query} className="dh-row"><div className="dh-row-head"><div className="dh-shimmer dh-skel-line" style={{ width: 180 }} /></div><SkeletonGrid count={4} /></section>
            ))}
            {featured?.sections?.map((section) => {
              const cat = CATEGORIES.find((c) => c.query === section.query);
              const Icon = cat?.icon || Tag;
              if (!section.items.length) return null;
              return (
                <section key={section.query} className="dh-row">
                  <div className="dh-row-head">
                    <h2><Icon size={18} /> Cheapest {cat?.label || section.query} today</h2>
                    <button type="button" onClick={() => runSearch(section.query)}>Compare all <ArrowUpRight size={14} /></button>
                  </div>
                  <div className="dh-rail">
                    {section.items.map((item, i) => <ProductCard key={item.id} item={item} region={featured.region} cheapest={i === 0} />)}
                  </div>
                </section>
              );
            })}
            {featured && !featured.sections?.some((s) => s.items.length) && !loading && (
              <div className="dh-empty">
                <Sparkles size={40} strokeWidth={1.4} />
                <h3>Search any product to compare prices</h3>
                <p>Pick a category above or type a product name to see the cheapest offers right now.</p>
              </div>
            )}
          </>
        )}

        <footer className="dh-footer">
          Prices and availability are checked live and re-checked every hour; the store's checkout price is final.
          Lowest-ever prices are from VetroAI's own hourly checks.
        </footer>
      </main>
    </div>
  );
}
