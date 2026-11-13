import React, { useId, useState } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { sourceDomain } from "../lib/sources";
import SourceFavicon from "./SourceFavicon";
import "./WebSearchBlock.css";

// How recently a result was published, in the fewest words that stay
// honest: "2h ago" reads as fresher than a bare date.
const formatFreshness = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const diffH = (Date.now() - d.getTime()) / 3600000;
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 24 * 7) return `${Math.round(diffH / 24)}d ago`;
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
};

/**
 * A reply's web search, the way Claude shows one: a quiet row above the
 * answer with the query that was searched and how many results came back,
 * which opens into the list of results (site icon, title, site). While the
 * search runs, the row says so. The answer cites these results inline
 * (CitationChip).
 */
const WebSearchBlock = React.memo(function WebSearchBlock({ query, sources, searching }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const items = (sources || []).map((s, i) => ({ ...s, n: i + 1, domain: sourceDomain(s) }));
  if (!items.length && !searching) return null;
  const label = String(query || "").trim();
  const count = items.length;

  if (!count) {
    return (
      <div className="wsb is-searching" role="status">
        <div className="wsb-head">
          <Globe className="wsb-globe" size={15} strokeWidth={2} aria-hidden="true" />
          <span className="wsb-label"><span className="wsb-shimmer">Searching the web</span>{label && <span className="wsb-query"> · {label}</span>}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`wsb${open ? " is-open" : ""}`}>
      <button type="button" className="wsb-head" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={listId}>
        <Globe className="wsb-globe" size={15} strokeWidth={2} aria-hidden="true" />
        <span className="wsb-label">{label || "Searched the web"}</span>
        <span className="wsb-count">{count} result{count === 1 ? "" : "s"}</span>
        <ChevronDown className="wsb-chevron" size={15} aria-hidden="true" />
      </button>
      {open && (
        <ol className="wsb-list" id={listId}>
          {items.map((s) => {
            const fresh = formatFreshness(s.published);
            return (
              <li key={s.n}>
                <a className="wsb-item" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title || s.url}>
                  <SourceFavicon domain={s.domain} />
                  <span className="wsb-title">{s.title && s.title !== "(untitled)" ? s.title : s.url}</span>
                  <span className="wsb-domain">{s.domain}{fresh ? ` · ${fresh}` : ""}</span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
});

export default WebSearchBlock;
