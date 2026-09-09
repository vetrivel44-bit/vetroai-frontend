import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Globe, X, ExternalLink, Sparkles, ArrowLeft, Loader, Search as SearchIcon, TrendingUp, CornerUpLeft, AlertCircle } from "lucide-react";

// Crisp modern search SVG icon
const SearchSvg = ({ size = 18, className = "" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ display: "inline-block", verticalAlign: "middle" }}
  >
    <circle cx="11" cy="11" r="7.5" />
    <path d="m20 20-4.35-4.35" />
  </svg>
);

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const _BASE = (import.meta.env.VITE_API_BASE_URL?.trim() || (import.meta.env.PROD ? "https://ai-chatbot-backend-gvvz.onrender.com" : "http://localhost:3000")).replace(/\/+$/, "");
const API = _BASE.endsWith("/api") ? _BASE : `${_BASE}/api`;

const SEARCH_SUGGESTIONS = [
  "What's trending in tech today?",
  "Latest AI news",
  "Current stock market",
  "Today's cricket scores",
  "Best laptops under $1000 2026",
  "Latest smartphone releases",
  "World news headlines today",
  "SpaceX launch updates",
  "Crypto market trends",
  "Electric vehicles news 2026",
  "Artificial Intelligence breakthroughs",
  "Global economy news",
];

const faviconUrl = (url) => {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
  } catch {
    return "";
  }
};

const displayDomain = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "";
  }
};

// Converts long unstructured summary paragraphs into structured points/bullet items
function formatStructuredAnswer(raw = "") {
  if (!raw || typeof raw !== "string") return [];

  // Check if answer already has explicit bullet points or numbered lists
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.map((line) => {
      // Strip leading bullet markers like '-', '*', '•', or '1.'
      const clean = line.replace(/^([*•\-]\s*|\d+[\.\)]\s*)/, "").trim();
      return clean;
    }).filter(Boolean);
  }

  // If answer is a continuous block separated by semicolons (common in Tavily advanced answers)
  if (raw.includes(";")) {
    const parts = raw.split(/;\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return parts.map((p) => p.replace(/\.$/, ""));
    }
  }

  // Split on sentences that introduce new topics ("while", "additionally", or standard sentence endings)
  const sentences = raw
    .replace(/;\s+/g, ". ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);

  return sentences.length ? sentences : [raw];
}

export default function WebSearchView({ onExitWebSearch }) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [results, setResults] = useState([]);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const filteredSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SEARCH_SUGGESTIONS.slice(0, 6);
    const matches = SEARCH_SUGGESTIONS.filter((s) => s.toLowerCase().includes(q));
    if (matches.length === 0) {
      return [
        `Search for "${query}"`,
        `Latest news on "${query}"`,
        `What is "${query}"`,
      ];
    }
    return matches.slice(0, 6);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (showDropdown) {
          setShowDropdown(false);
        } else if (onExitWebSearch) {
          onExitWebSearch();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExitWebSearch, showDropdown]);

  // Click outside listener for autocomplete dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        inputRef.current &&
        !inputRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    document.title = loading
      ? `Searching… ${searched || ""}`
      : searched
        ? `${searched} — Web Search`
        : "VetroAI Web Search";
    return () => {
      document.title = "VetroAI";
    };
  }, [loading, searched]);

  const runSearch = useCallback(async (rawQuery) => {
    const text = (rawQuery ?? query).trim();
    if (!text || loading) return;
    
    // Explicitly hide dropdown & remove focus from search input
    setShowDropdown(false);
    setFocusedIndex(-1);
    inputRef.current?.blur();
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }

    setLoading(true);
    setError("");
    setResults([]);
    setAnswer("");
    setSearched(text);
    setQuery(text);

    try {
      const res = await fetch(`${API}/web-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Search failed");
      const d = json.data || {};
      setAnswer(d.answer || "");
      setResults(d.results || []);
      setProvider(d.provider || "");
    } catch (e) {
      setError(e.message || "Failed to search the web. Please try again.");
    } finally {
      setLoading(false);
      setShowDropdown(false);
    }
  }, [query, loading]);

  const handleInputKeyDown = (e) => {
    if (!showDropdown) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setShowDropdown(true);
        setFocusedIndex(0);
        return;
      }
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % filteredSuggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      setShowDropdown(false);
      inputRef.current?.blur();
      if (focusedIndex >= 0 && filteredSuggestions[focusedIndex]) {
        runSearch(filteredSuggestions[focusedIndex]);
      } else {
        runSearch();
      }
    }
  };

  return (
    <div className="websearch-view">
      <div className="websearch-topbar">
        <div className="websearch-brand">
          <span className="websearch-brand-icon"><Globe size={17} /></span>
          <span className="websearch-brand-name">Web Search</span>
          <span className="websearch-brand-badge">real-time</span>
        </div>
        {onExitWebSearch && (
          <button type="button" className="websearch-back" onClick={onExitWebSearch} title="Close search (Esc)">
            <X size={15} />
            <span>Close</span>
          </button>
        )}
      </div>

      <div className="websearch-scroll">
        <div className="websearch-wrap">
          {!searched ? (
            <div className="websearch-hero">
              <Globe size={26} className="websearch-hero-icon" />
              <h1 className="websearch-title">Search the web</h1>
              <p className="websearch-subtitle">Real-time results powered by Tavily — fresh answers with sources.</p>

              <div className="websearch-composer-wrapper">
                <form
                  className="websearch-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setShowDropdown(false);
                    inputRef.current?.blur();
                    runSearch();
                  }}
                >
                  <SearchSvg size={18} className="websearch-composer-icon" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setShowDropdown(true);
                      setFocusedIndex(-1);
                    }}
                    onFocus={() => {
                      if (!loading) setShowDropdown(true);
                    }}
                    onKeyDown={handleInputKeyDown}
                    placeholder="What do you want to search for?"
                    className="websearch-composer-input"
                    autoComplete="off"
                  />
                  {query && (
                    <button
                      type="button"
                      className="websearch-clear"
                      onClick={() => {
                        setQuery("");
                        setShowDropdown(false);
                        inputRef.current?.focus();
                      }}
                      aria-label="Clear"
                    >
                      <X size={15} />
                    </button>
                  )}
                  <button
                    type="submit"
                    className="websearch-go"
                    disabled={loading}
                    onClick={() => {
                      setShowDropdown(false);
                      inputRef.current?.blur();
                    }}
                  >
                    {loading ? <Loader size={14} className="spin" /> : <Sparkles size={14} />}
                    <span>Search</span>
                  </button>
                </form>

                {showDropdown && !loading && filteredSuggestions.length > 0 && (
                  <div className="websearch-autocomplete-dropdown" ref={dropdownRef}>
                    <div className="websearch-autocomplete-header">
                      <span>{query ? "Google-Style Suggestions" : "Trending Searches"}</span>
                    </div>
                    {filteredSuggestions.map((item, idx) => (
                      <div
                        key={idx}
                        className={`websearch-autocomplete-item ${idx === focusedIndex ? "focused" : ""}`}
                        onClick={() => {
                          setShowDropdown(false);
                          inputRef.current?.blur();
                          runSearch(item);
                        }}
                        onMouseEnter={() => setFocusedIndex(idx)}
                      >
                        <div className="websearch-auto-item-left">
                          {query ? <SearchSvg size={14} className="websearch-auto-icon" /> : <TrendingUp size={14} className="websearch-auto-icon trending" />}
                          <span className="websearch-auto-text">{item}</span>
                        </div>
                        <button
                          type="button"
                          className="websearch-auto-fill-btn"
                          title="Insert into search bar"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuery(item);
                            inputRef.current?.focus();
                          }}
                        >
                          <CornerUpLeft size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="websearch-suggestions">
                <span className="websearch-suggestions-label">Try searching</span>
                <div className="websearch-pills">
                  {SEARCH_SUGGESTIONS.slice(0, 6).map((s) => (
                    <button
                      type="button"
                      key={s}
                      className="websearch-pill"
                      onClick={() => {
                        setShowDropdown(false);
                        inputRef.current?.blur();
                        setQuery(s);
                        runSearch(s);
                      }}
                    >
                      <SearchSvg size={12} />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="websearch-results">
              <div className="websearch-composer-wrapper">
                <form
                  className="websearch-composer websearch-composer-compact"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setShowDropdown(false);
                    inputRef.current?.blur();
                    runSearch();
                  }}
                >
                  <SearchSvg size={16} className="websearch-composer-icon" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setShowDropdown(true);
                      setFocusedIndex(-1);
                    }}
                    onFocus={() => {
                      if (!loading) setShowDropdown(true);
                    }}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Search again…"
                    className="websearch-composer-input"
                    autoComplete="off"
                  />
                  {query && (
                    <button
                      type="button"
                      className="websearch-clear"
                      onClick={() => {
                        setQuery("");
                        setShowDropdown(false);
                      }}
                      aria-label="Clear"
                    >
                      <X size={14} />
                    </button>
                  )}
                  <button
                    type="submit"
                    className="websearch-go"
                    disabled={loading}
                    title="Search"
                    onClick={() => {
                      setShowDropdown(false);
                      inputRef.current?.blur();
                    }}
                  >
                    {loading ? <Loader size={14} className="spin" /> : <SearchSvg size={14} />}
                  </button>
                </form>

                {showDropdown && !loading && filteredSuggestions.length > 0 && (
                  <div className="websearch-autocomplete-dropdown compact" ref={dropdownRef}>
                    {filteredSuggestions.map((item, idx) => (
                      <div
                        key={idx}
                        className={`websearch-autocomplete-item ${idx === focusedIndex ? "focused" : ""}`}
                        onClick={() => {
                          setShowDropdown(false);
                          inputRef.current?.blur();
                          runSearch(item);
                        }}
                        onMouseEnter={() => setFocusedIndex(idx)}
                      >
                        <div className="websearch-auto-item-left">
                          <SearchSvg size={14} className="websearch-auto-icon" />
                          <span className="websearch-auto-text">{item}</span>
                        </div>
                        <button
                          type="button"
                          className="websearch-auto-fill-btn"
                          title="Insert into search bar"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuery(item);
                            inputRef.current?.focus();
                          }}
                        >
                          <CornerUpLeft size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="websearch-meta">
                <span className="websearch-meta-query">{searched}</span>
                {!loading && (
                  <span className="websearch-meta-info">
                    {results.length > 0 ? `${results.length} results · ` : ""}Tavily
                  </span>
                )}
              </div>

              {loading && (
                <div className="websearch-skeletons">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="websearch-skel">
                      <div className="websearch-skel-line w30" />
                      <div className="websearch-skel-line w80" />
                      <div className="websearch-skel-line w60" />
                      <div className="websearch-skel-line w90" />
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="websearch-error">
                  <span className="websearch-error-icon"><AlertCircle size={18} /></span>
                  <div>
                    <strong>Search failed</strong>
                    <p>{error}</p>
                  </div>
                  <button type="button" className="websearch-retry" onClick={() => runSearch(searched)}>Retry</button>
                </div>
              )}

              {!loading && !error && answer && (() => {
                const items = formatStructuredAnswer(answer);
                return (
                  <div className="websearch-answer">
                    <div className="websearch-answer-label">
                      <Sparkles size={13} />
                      AI Key Findings
                    </div>
                    {items.length > 1 ? (
                      <ul className="websearch-structured-list">
                        {items.map((item, idx) => (
                          <li key={idx} className="websearch-structured-item">
                            <span className="websearch-structured-bullet"><Sparkles size={11} /></span>
                            <span className="websearch-structured-text">{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="websearch-answer-text">{answer}</p>
                    )}
                  </div>
                );
              })()}

              {!loading && !error && results.length > 0 && (
                <div className="websearch-list">
                  {results.map((r, idx) => (
                    <a key={idx} href={r.url} target="_blank" rel="noopener noreferrer" className="websearch-card">
                      <div className="websearch-card-top">
                        {faviconUrl(r.url) ? (
                          <img src={faviconUrl(r.url)} alt="" className="websearch-card-favicon" loading="lazy" />
                        ) : (
                          <span className="websearch-card-favicon websearch-card-favicon-fallback">
                            <Globe size={13} />
                          </span>
                        )}
                        <span className="websearch-card-domain">{displayDomain(r.url)}</span>
                        <span className="websearch-card-rank">{idx + 1}</span>
                      </div>
                      <div className="websearch-card-title">{r.title}</div>
                      <div className="websearch-card-snippet">{r.snippet}</div>
                      <div className="websearch-card-foot">
                        <span className="websearch-card-url">{r.url}</span>
                        <ExternalLink size={13} className="websearch-card-open" />
                      </div>
                    </a>
                  ))}
                </div>
              )}

              {!loading && !error && !answer && results.length === 0 && (
                <div className="websearch-empty">
                  <SearchSvg size={22} />
                  <p>No results found for “{searched}”. Try different keywords.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}