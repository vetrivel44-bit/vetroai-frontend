import React from "react";
import { ArrowUpRight } from "lucide-react";
import { sourceDomain, siteName } from "../lib/sources";
import SourceFavicon from "./SourceFavicon";
import "./CitationChip.css";

const formatDate = (value) => {
  const t = Date.parse(value || "");
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
};

/**
 * An inline citation: a small chip with the source's icon and number, linking
 * to the source. Hovering or focusing it shows the source's title, site and
 * date. A number with no matching source stays as plain "[n]".
 */
const CitationChip = React.memo(function CitationChip({ n, source }) {
  if (!source?.url) return <span className="vai-cite-plain">[{n}]</span>;
  const domain = sourceDomain(source);
  const title = source.title && source.title !== "(untitled)" ? source.title : domain;
  const date = formatDate(source.published);
  return (
    <span className="vai-cite">
      <a className="vai-cite-chip" href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${n}: ${title} (${domain})`}>
        <SourceFavicon domain={domain} />
        <span className="vai-cite-n">{n}</span>
      </a>
      <span className="vai-cite-card" role="tooltip">
        <span className="vai-cite-site">
          <SourceFavicon domain={domain} />
          <span className="vai-cite-site-name">{siteName(domain) || domain}</span>
          <span className="vai-cite-domain">{domain}{date ? ` · ${date}` : ""}</span>
        </span>
        <span className="vai-cite-title">{title}</span>
        <span className="vai-cite-open">Source {n} <ArrowUpRight size={12} strokeWidth={2.2} /></span>
      </span>
    </span>
  );
});

export default CitationChip;
