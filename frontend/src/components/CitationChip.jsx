import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { sourceDomain, siteName } from "../lib/sources";
import SourceFavicon from "./SourceFavicon";
import "./CitationChip.css";

const formatDate = (value) => {
  const t = Date.parse(value || "");
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
};

const touchOnly = () => typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;

/**
 * An inline citation, the way Claude shows one: a small pill with the site's
 * name ("timesofindia"), and "+2" when several sources back the same claim.
 * Hovering or focusing it shows a card with each source's site, title and
 * date; on a phone the first tap opens the card and a tap on a source opens
 * it. Numbers with no matching source stay as plain "[n]".
 */
const CitationChip = React.memo(function CitationChip({ numbers, sources }) {
  const [open, setOpen] = useState(false);
  // Near the right edge the card opens leftwards, so it never runs off screen.
  const [flip, setFlip] = useState(false);
  const ref = useRef(null);
  const place = () => {
    const rect = ref.current?.getBoundingClientRect?.();
    if (rect && typeof window !== "undefined") setFlip(rect.left + 330 > window.innerWidth);
  };
  const items = (numbers || [])
    .map((n) => ({ n, source: sources?.[n - 1] }))
    .filter((item) => item.source?.url)
    .map(({ n, source }) => {
      const domain = sourceDomain(source);
      return { n, url: source.url, domain, site: siteName(domain) || domain, title: source.title && source.title !== "(untitled)" ? source.title : domain, date: formatDate(source.published) };
    });

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!items.length) return <span className="vai-cite-plain">[{(numbers || []).join(", ")}]</span>;
  const [first] = items;
  const more = items.length - 1;
  const label = `${items.length > 1 ? `${items.length} sources: ` : "Source: "}${items.map((i) => i.site).join(", ")}`;

  return (
    <span className={`vai-cite${open ? " is-open" : ""}${flip ? " is-flip" : ""}`} ref={ref} onMouseEnter={place} onFocus={place}>
      <a
        className="vai-cite-chip"
        href={first.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        onClick={(event) => { if (touchOnly() && !open) { event.preventDefault(); place(); setOpen(true); } }}
      >
        <span className="vai-cite-name">{first.site}</span>
        {more > 0 && <span className="vai-cite-more">+{more}</span>}
      </a>
      <span className="vai-cite-card" role="tooltip">
        {items.slice(0, 6).map((item) => (
          <a key={item.n} className="vai-cite-item" href={item.url} target="_blank" rel="noopener noreferrer">
            <span className="vai-cite-site">
              <SourceFavicon domain={item.domain} />
              <span className="vai-cite-site-name">{item.site}</span>
              <span className="vai-cite-domain">{item.domain}{item.date ? ` · ${item.date}` : ""}</span>
              <ArrowUpRight className="vai-cite-go" size={13} strokeWidth={2.2} />
            </span>
            <span className="vai-cite-title">{item.title}</span>
          </a>
        ))}
      </span>
    </span>
  );
});

export default CitationChip;
