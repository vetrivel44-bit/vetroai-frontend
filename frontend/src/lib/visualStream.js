import { createContext } from "react";

// While a reply streams, the source of the fenced block that is still being
// written (its closing ``` hasn't arrived), or null. Visual blocks — Mermaid
// diagrams, charts, widgets, maps — show a placeholder for that block instead
// of parsing half of it.
export const OpenBlockContext = createContext(null);

export function openFenceTail(content) {
  const text = String(content || "");
  const fences = (text.match(/^[ \t]*```/gm) || []).length;
  if (fences % 2 === 0) return null;
  const open = text.search(/^[ \t]*```[^\n]*\n(?![\s\S]*^[ \t]*```)/m);
  if (open === -1) return null;
  return text.slice(open).replace(/^[ \t]*```[^\n]*\n/, "");
}

// True when `code` is the block still streaming in.
export const isStillStreaming = (openTail, code) => openTail != null && openTail.trim() === String(code).trim();
