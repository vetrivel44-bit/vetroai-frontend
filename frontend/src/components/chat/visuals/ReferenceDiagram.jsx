import React, { useState } from "react";
import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";

/**
 * An accurate labelled diagram from Wikimedia Commons
 * (lib/referenceDiagrams.js), credited to its author with its licence, with
 * the other good matches a tap away.
 */
export default function ReferenceDiagram({ list }) {
  const [at, setAt] = useState(0);
  const item = list[at % list.length];
  if (!item) return null;
  return (
    <figure className="vref">
      <a className="vref-frame" href={item.page} target="_blank" rel="noopener noreferrer" title="Open on Wikimedia Commons">
        <img src={item.image} alt={`Labelled diagram: ${item.title}`} loading="lazy" referrerPolicy="no-referrer" />
      </a>
      <figcaption>
        <span className="vref-head"><BookOpen size={13} /> Textbook diagram</span>
        <span className="vref-credit">
          {item.title}{item.author ? ` · ${item.author}` : ""} · {item.license} ·{" "}
          <a href={item.page} target="_blank" rel="noopener noreferrer">Wikimedia Commons <ExternalLink size={11} /></a>
        </span>
        {list.length > 1 && (
          <button type="button" className="vref-next" onClick={() => setAt((n) => (n + 1) % list.length)}>
            <RefreshCw size={12} /> Another diagram ({(at % list.length) + 1}/{list.length})
          </button>
        )}
      </figcaption>
    </figure>
  );
}
