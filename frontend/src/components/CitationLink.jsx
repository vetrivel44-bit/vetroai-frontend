import React, { useContext } from "react";
import { citationNumber } from "../lib/citations";
import { CitationContext } from "../lib/citationContext";
import CitationChip from "./CitationChip";

/**
 * Markdown's link renderer: a "#cite-n" link (from remarkCitations) becomes a
 * source chip; every other link renders as an ordinary link. (`node` is
 * react-markdown's syntax node, kept off the DOM.)
 */
export function CitationLink(props) {
  const sources = useContext(CitationContext);
  const n = citationNumber(props.href);
  if (n != null) return <CitationChip n={n} source={sources?.[n - 1]} />;
  const { children, ...attributes } = props;
  delete attributes.node;
  return <a {...attributes}>{children}</a>;
}
