// Clean-ups applied to a model's Mermaid source before it is drawn
// (components/chat/MermaidDiagram.jsx).

// Colours the model writes itself ("style A fill:#ffeb3b", neon classDefs,
// a magenta linkStyle) ignore the chat's theme: a yellow box kept the dark
// theme's white text and could not be read. They are dropped, along with
// %%{init}%% theme overrides, so every diagram uses the palette in
// MermaidDiagram.jsx, which is tuned for contrast in both themes.
export function stripModelStyling(code) {
  return String(code)
    .split("\n")
    .filter((line) => !/^\s*(style|classDef|class|linkStyle)\s/.test(line) && !/^\s*%%\{.*\}%%\s*$/.test(line))
    .join("\n")
    .replace(/(\S):::[A-Za-z_][\w-]*/g, "$1");
}

// A subgraph without its own `direction` can lay out across the parent's
// flow (a top-down chart with a sideways group), which made tall diagrams
// too wide for a phone. Each group follows the chart's direction unless it
// says otherwise.
export function alignSubgraphs(code) {
  const dir = String(code).match(/^\s*(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/m)?.[1];
  if (!dir) return code;
  const lines = String(code).split("\n");
  const out = [];
  lines.forEach((line, i) => {
    out.push(line);
    const m = line.match(/^(\s*)subgraph\b/);
    if (m && !/^\s*direction\s/.test(lines[i + 1] || "")) out.push(`${m[1]}  direction ${dir === "TD" ? "TB" : dir}`);
  });
  return out.join("\n");
}

// Whether the source itself asks for the hand-drawn look (Mermaid's own
// front-matter `look: handDrawn`).
export const wantsHandDrawn = (code) => /^\s*look:\s*handDrawn\b/m.test(String(code || ""));
