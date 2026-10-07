import test from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

import { citationNumber, remarkCitations, splitCitations } from "../src/lib/citations.js";
import { siteName, sourceDomain } from "../src/lib/sources.js";

// Runs the plugin the way the chat does and lists what it produced.
function citeTree(markdown) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCitations);
  return processor.runSync(processor.parse(markdown));
}
const links = (node, out = []) => {
  if (node.type === "link") out.push(node.url);
  (node.children || []).forEach((c) => links(c, out));
  return out;
};

test("[n] in text becomes a citation link; the text around it stays", () => {
  assert.deepEqual(splitCitations("Solar is cheaper [1][3], wind costs more [12]."), [
    { type: "text", value: "Solar is cheaper " },
    { type: "link", url: "#cite-1", title: null, children: [{ type: "text", value: "1" }] },
    { type: "link", url: "#cite-3", title: null, children: [{ type: "text", value: "3" }] },
    { type: "text", value: ", wind costs more " },
    { type: "link", url: "#cite-12", title: null, children: [{ type: "text", value: "12" }] },
    { type: "text", value: "." },
  ]);
  assert.equal(splitCitations("no citations here"), null);
  assert.equal(splitCitations("not [0] and not [1234] or [a]"), null);
});

test("citations are found in paragraphs, lists, tables and emphasis — never in code or links", () => {
  const tree = citeTree([
    "Bottom line **₹2.48 [1]** and *wind [4]*.",
    "",
    "- item [2]",
    "",
    "| a | b |",
    "|---|---|",
    "| x | 3.18 [5] |",
    "",
    "Code `arr[1]` and a [real link [7]](https://example.com).",
    "",
    "```js",
    "const x = list[3];",
    "```",
  ].join("\n"));
  assert.deepEqual(links(tree), ["#cite-1", "#cite-4", "#cite-2", "#cite-5", "https://example.com"]);
});

test("a citation link's number is read back, anything else is not a citation", () => {
  assert.equal(citationNumber("#cite-7"), 7);
  assert.equal(citationNumber("https://example.com/#cite-7"), null);
  assert.equal(citationNumber("#cite-x"), null);
  assert.equal(citationNumber(undefined), null);
});

test("sites are named the way people say them", () => {
  assert.equal(siteName("seci.gov.in"), "seci");
  assert.equal(siteName("en.wikipedia.org"), "wikipedia");
  assert.equal(siteName("bbc.co.uk"), "bbc");
  assert.equal(siteName("reuters.com"), "reuters");
  assert.equal(siteName("localhost"), "localhost");
  assert.equal(siteName(""), "");
  assert.equal(sourceDomain({ url: "https://www.reuters.com/x" }), "reuters.com");
  assert.equal(sourceDomain({ url: "https://a.test", domain: "given.test" }), "given.test");
});
