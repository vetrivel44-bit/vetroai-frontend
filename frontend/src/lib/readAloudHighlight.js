// Read aloud's highlight: the sentence being heard, marked in the reply.
//
// The speaker (lib/voiceStream.js) says which sentence it's on, as the text
// it sent to the voice. That text has had its markdown, links, emoji and
// citations taken out, so it isn't found in the page as-is: it is matched
// word by word against the reply's visible text instead, from where the last
// sentence ended. The mark is a CSS Custom Highlight ("::highlight(read-aloud)"
// in ReadAloudBar.css), so the reply's DOM, which React owns, isn't touched.
// Browsers without custom highlights (Firefox before 140) just don't mark it.

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

/** The words of `text`, lowercased, with where each is in it. */
export function wordsOf(text) {
  const out = [];
  for (const match of String(text || "").matchAll(WORD)) {
    out.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
  }
  return out;
}

/**
 * Where `sentence` is in `text`, searching from character `from`: its first
 * few words, then its last word a little either side of where it should
 * end. { start, end } character offsets, or null when it isn't there.
 */
export function locateSentence(text, sentence, from = 0) {
  const wanted = wordsOf(sentence).map((w) => w.word);
  if (!wanted.length) return null;
  const words = wordsOf(text);
  // Its first three words; then two, then one, as the voice's text can differ
  // from the page soon after the start ("e.g." was sent as "for example").
  for (let lead = Math.min(3, wanted.length); lead >= 1; lead--) {
    for (let i = 0; i + lead <= words.length; i++) {
      if (words[i].start < from) continue;
      let same = true;
      for (let k = 0; k < lead && same; k++) same = words[i + k].word === wanted[k];
      if (!same) continue;
      // The last word, near where the sentence's length puts it.
      const expected = i + wanted.length - 1;
      const last = wanted[wanted.length - 1];
      let end = Math.min(expected, words.length - 1);
      for (let j = Math.max(i, expected - 3); j <= Math.min(words.length - 1, expected + 6); j++) {
        if (words[j].word === last) { end = j; if (j >= expected) break; }
      }
      return { start: words[i].start, end: words[end].end };
    }
  }
  return null;
}

/** The text nodes under `root` that are read, with where each starts in their joined text. */
function textNodes(root) {
  const doc = root?.ownerDocument;
  if (!doc?.createTreeWalker) return { text: "", nodes: [] };
  const SHOW_TEXT = 4;
  const walker = doc.createTreeWalker(root, SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("button, [data-read-skip], pre, code, svg, style, script") ? 2 /* reject */ : 1 /* accept */),
  });
  const nodes = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: text.length });
    text += node.nodeValue;
    text += " "; // block boundaries
  }
  return { text, nodes };
}

/** A DOM Range over characters start–end of the joined text. */
function rangeFor(doc, nodes, start, end) {
  const at = (offset) => {
    let found = nodes[0];
    for (const entry of nodes) { if (entry.start <= offset) found = entry; else break; }
    return { node: found.node, offset: Math.min(found.node.nodeValue.length, Math.max(0, offset - found.start)) };
  };
  const a = at(start);
  const b = at(end);
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

const NAME = "read-aloud";

/**
 * A highlighter for one reply's element. show(index, sentence) marks a
 * sentence (index: its place in the reading, so a skip back is found from
 * where that sentence was); clear() removes the mark.
 */
export function createReadHighlighter(getRoot) {
  const found = new Map(); // sentence index → { start, end }
  const highlights = () => (typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function" ? CSS.highlights : null);
  const clear = () => { try { highlights()?.delete(NAME); } catch { /* unsupported */ } };
  const show = (index, sentence) => {
    const registry = highlights();
    const root = getRoot();
    if (!registry || !root) return;
    try {
      const { text, nodes } = textNodes(root);
      if (!nodes.length) return;
      let spot = found.get(index);
      if (!spot) {
        // From the end of the nearest sentence before it that was found.
        let from = 0;
        for (const [i, place] of found) if (i < index && place.end > from) from = place.end;
        spot = locateSentence(text, sentence, from) || (from ? locateSentence(text, sentence, 0) : null);
        if (spot) found.set(index, spot);
      }
      if (!spot) { clear(); return; }
      registry.set(NAME, new Highlight(rangeFor(root.ownerDocument, nodes, spot.start, spot.end)));
    } catch {
      clear();
    }
  };
  return { show, clear };
}
