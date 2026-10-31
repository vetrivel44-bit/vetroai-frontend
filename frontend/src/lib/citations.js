// Inline citations in research answers. The writer cites its numbered
// sources as [n]; this remark plugin turns each [n] in the text into a link
// to "#cite-n", which the chat renders as a source chip (CitationChip).
// Code, inline code and existing links are left alone.

// gpt-oss (Groq's default model) cites in its own browsing format,
// 【5†L1-L4】: read as [5]. The backend converts these as it streams; this
// also covers replies saved before it did. Unnumbered ones (【news†L3】) point
// at nothing the app can show and are dropped. Brackets that aren't citations
// (【重要】: no number, no †) are left alone.
const CITATION = /\[(\d{1,3})\]|【(\d{1,3})(?:†[^】\n]{0,80})?】/g;
const UNNUMBERED_MARK = /【[^】\n]{0,80}†[^】\n]{0,80}】/g;
const SKIP = new Set(["code", "inlineCode", "link", "linkReference", "math", "inlineMath", "html"]);

export const citationHref = (n) => `#cite-${n}`;

/** The source number a "#cite-n" link points at, or null. */
export function citationNumber(href) {
  const match = /^#cite-(\d{1,3})$/.exec(href || "");
  return match ? Number(match[1]) : null;
}

/** Splits a text node's value into text and citation-link nodes. */
export function splitCitations(raw) {
  const value = raw.replace(UNNUMBERED_MARK, (m) => (/^【\d/.test(m) ? m : ""));
  const nodes = [];
  let last = 0;
  for (const match of value.matchAll(CITATION)) {
    const n = Number(match[1] ?? match[2]);
    if (n < 1) continue;
    if (match.index > last) nodes.push({ type: "text", value: value.slice(last, match.index) });
    nodes.push({ type: "link", url: citationHref(n), title: null, children: [{ type: "text", value: String(n) }] });
    last = match.index + match[0].length;
  }
  if (!nodes.length) return value === raw ? null : [{ type: "text", value }];
  if (last < value.length) nodes.push({ type: "text", value: value.slice(last) });
  return nodes;
}

function transform(node) {
  if (!node || !Array.isArray(node.children) || SKIP.has(node.type)) return;
  const next = [];
  for (const child of node.children) {
    const split = child.type === "text" ? splitCitations(child.value) : null;
    if (split) next.push(...split);
    else {
      transform(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkCitations() {
  return (tree) => transform(tree);
}

// A reply with no sources can still carry "[1], [3]" copied from an earlier
// searched answer: numbers that point nowhere. They are dropped from prose
// (never from code or links), with a "Sources: [1], [2]" line left empty.
// `arr[1]` keeps its index: only a [n] not glued to a word goes.
const STRAY_CITATIONS = /(?<![\w\]])[ \t]*\[\d{1,3}\](?:\s*[,–-]?\s*\[\d{1,3}\])*/g;
const EMPTY_SOURCES_LINE = /^\s*(sources?|references?|citations?)\s*:?\s*[.,;]*\s*$/i;

/** `value` without stray [n] citations. */
export function dropCitations(value) {
  return String(value).replace(/[ \t]*【[^】\n]{0,80}†[^】\n]{0,80}】|[ \t]*【\d{1,3}】/g, "").replace(STRAY_CITATIONS, "");
}

const textOf = (node) => (node.type === "text" ? node.value : (node.children || []).map(textOf).join(""));

function drop(node) {
  if (!node || !Array.isArray(node.children) || SKIP.has(node.type)) return;
  for (const child of node.children) {
    if (child.type === "text") child.value = dropCitations(child.value);
    else drop(child);
  }
  node.children = node.children.filter((c) => !(c.type === "paragraph" && EMPTY_SOURCES_LINE.test(textOf(c)) && textOf(c).trim()));
}

export function remarkDropCitations() {
  return (tree) => drop(tree);
}
