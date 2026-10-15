import { createContext, useContext, useEffect, useRef, useState } from "react";

// ── Smooth reveal for a streaming reply ──────────────────────────────────────
// Providers send text in uneven bursts: nothing for a moment, then a whole
// sentence at once. Showing it as it lands makes a reply jump. Instead the
// visible text follows the received text at a steady pace — a little faster
// when it falls behind — and stops on word boundaries, so words appear whole.
// New words then fade in (rehypeStreamWords below) rather than popping.

export const REVEAL_TICK_MS = 32;

// How far the visible text should reach on the next tick. While more text is
// still coming (`final` false), a half-received word at the very end is held
// back rather than shown as "Marin" before "Marina".
export function nextRevealLength(text, shown, final = true, target = text.length) {
  if (shown >= target) return target;
  const backlog = target - shown;
  // ~120 chars/s when caught up; a backlog shrinks by an eighth per tick.
  let next = Math.min(target, shown + Math.max(4, Math.ceil(backlog / 8)));
  // Finish the word in progress if the rest of it has arrived.
  const rest = text.slice(next, Math.min(target, next + 24));
  const boundary = rest.search(/[\s.,;:!?)\]}"'”’]/);
  if (boundary > 0) next += boundary;
  if (!final && next >= target && /\S$/.test(text.slice(0, target))) {
    const lastSpace = text.slice(0, target).search(/\s\S*$/);
    if (lastSpace > shown) next = lastSpace;
    else if (target - shown < 24) return shown; // wait for the word to finish
  }
  // Never split a surrogate pair (emoji).
  const code = text.charCodeAt(next - 1);
  if (code >= 0xd800 && code <= 0xdbff && next < target) next += 1;
  return Math.min(next, target);
}

// The part of `content` to show, and whether the reply is still "live" (still
// streaming, or still catching up with what has streamed).
export function useSmoothStream(content, streaming) {
  const text = String(content || "");
  // A reply opened from history, or one already long when this mounts, shows
  // at once; only text arriving from here on is paced.
  const [shown, setShown] = useState(() => (streaming && text.length < 400 ? 0 : text.length));
  // Read by the interval below, which outlives any one render.
  const textRef = useRef(text);
  const streamingRef = useRef(streaming);
  useEffect(() => { textRef.current = text; streamingRef.current = streaming; }, [text, streaming]);

  const behind = shown < text.length;
  useEffect(() => {
    if (!behind) return undefined;
    // (re-armed when streaming ends, to release a held-back last word)
    const id = setInterval(() => {
      setShown((s) => {
        const t = textRef.current;
        return s > t.length ? t.length : nextRevealLength(t, s, !streamingRef.current);
      });
    }, REVEAL_TICK_MS);
    return () => clearInterval(id);
  }, [behind, streaming]);

  // Regenerated or edited text that is shorter than what was shown.
  const visible = Math.min(shown, text.length);
  return { text: text.slice(0, visible), live: streaming || visible < text.length };
}

// ── Word fade-in ─────────────────────────────────────────────────────────────
// A rehype plugin, used only while a reply is live: in the last block of the
// reply, every word becomes <span class="vai-w">. React keeps the spans it
// already rendered, so only newly arrived words mount — and only they play
// the CSS fade. Earlier blocks are finished and stay plain text, as does
// everything once the reply is complete.

const SKIP_TAGS = new Set(["pre", "code", "svg", "math", "script", "style"]);
const isKatex = (node) => {
  const cls = node.properties?.className;
  return Array.isArray(cls) ? cls.some((c) => String(c).startsWith("katex")) : String(cls || "").startsWith("katex");
};

function wrapWords(node) {
  if (!node.children) return;
  const out = [];
  for (const child of node.children) {
    if (child.type === "text") {
      for (const part of child.value.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) out.push({ type: "text", value: part });
        else out.push({ type: "element", tagName: "span", properties: { className: ["vai-w"] }, children: [{ type: "text", value: part }] });
      }
    } else {
      if (child.type === "element" && !SKIP_TAGS.has(child.tagName) && !isKatex(child)) wrapWords(child);
      out.push(child);
    }
  }
  node.children = out;
}

export function rehypeStreamWords() {
  return (tree) => {
    const blocks = (tree.children || []).filter((c) => c.type === "element");
    const last = blocks[blocks.length - 1];
    if (last && !SKIP_TAGS.has(last.tagName)) wrapWords(last);
  };
}

// ── "Was this visual born live?" ─────────────────────────────────────────────
// Diagrams, charts and maps animate in when they arrive during a reply, not
// when an old conversation is reopened (a page of diagrams all animating at
// once would be noise). The reply's live flag is shared through context and
// read once, when the visual mounts.

export const ReplyLiveContext = createContext(false);

export function useBornLive() {
  const live = useContext(ReplyLiveContext);
  const [born] = useState(live);
  return born;
}
