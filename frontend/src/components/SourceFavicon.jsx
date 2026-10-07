import React, { useState } from "react";
import { faviconSources, siteName } from "../lib/sources";

// A site's icon, falling back through a few icon services and then to the
// site's first letter. Styled by .px-src-favicon (styles/sourceCards.css).
// data-no-image-tools: an icon, so rich-output-tools.js gives it no
// Download/Share buttons.
export default function SourceFavicon({ domain, className = "" }) {
  const [attempt, setAttempt] = useState(0);
  const sources = domain ? faviconSources(domain) : [];
  if (attempt >= sources.length) {
    const letter = (siteName(domain) || "?")[0].toUpperCase();
    return <span className={`px-src-favicon px-src-favicon-letter ${className}`.trim()} aria-hidden="true">{letter}</span>;
  }
  return (
    <img
      key={attempt}
      className={`px-src-favicon ${className}`.trim()}
      src={sources[attempt]}
      alt=""
      data-no-image-tools=""
      referrerPolicy="no-referrer"
      onError={() => setAttempt((n) => n + 1)}
    />
  );
}
