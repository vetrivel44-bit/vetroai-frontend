import { createContext } from "react";

// While a reply streams, the Mermaid source of the diagram that is still
// being written (its closing ``` hasn't arrived), or null. MermaidDiagram
// shows "Drawing diagram…" for that block instead of parsing half a diagram.
export const OpenDiagramContext = createContext(null);

export function openMermaidTail(content) {
  const text = String(content || "");
  const fences = (text.match(/^[ \t]*```/gm) || []).length;
  if (fences % 2 === 0) return null;
  const open = text.search(/```mermaid[^\n]*\n(?![\s\S]*```)/);
  if (open === -1) return null;
  return text.slice(open).replace(/^```mermaid[^\n]*\n/, "");
}
