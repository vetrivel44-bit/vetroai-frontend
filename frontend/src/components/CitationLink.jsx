import React, { useContext } from "react";
import { citationNumbers } from "../lib/citations";
import { CitationContext } from "../lib/citationContext";
import CitationChip from "./CitationChip";

/**
 * Markdown's link renderer: a "#cite-n" or "#cite-1,3" link (from
 * remarkCitations) becomes a source chip; every other link renders as an
 * ordinary link. (`node` is react-markdown's syntax node, kept off the DOM.)
 */
export function CitationLink(props) {
  const sources = useContext(CitationContext);
  const numbers = citationNumbers(props.href);
  if (numbers) return <CitationChip numbers={numbers} sources={sources} />;
  const { children, ...attributes } = props;
  delete attributes.node;
  return <a {...attributes}>{children}</a>;
}
