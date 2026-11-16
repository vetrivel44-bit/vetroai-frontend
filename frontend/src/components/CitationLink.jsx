import React, { useContext, useState } from "react";
import { citationNumbers } from "../lib/citations";
import { CitationContext } from "../lib/citationContext";
import { imageAlt, isImageUrl } from "../lib/inlineImages";
import CitationChip from "./CitationChip";

const textOf = (children) => React.Children.toArray(children).map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : "")).join("");

/**
 * A picture in a reply, opening full size in a new tab. If it won't load,
 * the link (or nothing, for a markdown image) is shown instead.
 */
export function InlineImage({ src, alt = "", fallback = null }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    <a className="vai-inline-img-link" href={src} target="_blank" rel="noopener noreferrer" title={alt || "Open the picture"}>
      <img className="vai-inline-img" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </a>
  );
}

/** Markdown's image renderer: ![alt](url) as an InlineImage. */
export function MarkdownImage({ src, alt }) {
  if (!isImageUrl(src)) return null;
  return <InlineImage src={src} alt={alt || ""} />;
}

/**
 * Markdown's link renderer: a "#cite-n" or "#cite-1,3" link (from
 * remarkCitations) becomes a source chip; a link straight to a picture shows
 * the picture (lib/inlineImages.js); every other link renders as an
 * ordinary link. (`node` is react-markdown's syntax node, kept off the DOM.)
 */
export function CitationLink(props) {
  const sources = useContext(CitationContext);
  const numbers = citationNumbers(props.href);
  if (numbers) return <CitationChip numbers={numbers} sources={sources} />;
  const { children, ...attributes } = props;
  delete attributes.node;
  const link = <a {...attributes}>{children}</a>;
  if (isImageUrl(props.href)) {
    return <InlineImage src={props.href} alt={imageAlt(textOf(children), props.href)} fallback={link} />;
  }
  return link;
}
