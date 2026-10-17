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

// The part of a flowchart written so far that can already be drawn, so the
// diagram grows while the reply streams: whole lines only, any group still
// open is closed. Empty until there is a header and something to draw, and
// for other kinds of diagram (they are drawn when the block is finished).
export function drawablePrefix(code) {
  const text = String(code || "");
  const cut = text.lastIndexOf("\n");
  if (cut < 0) return "";
  let lines = text.slice(0, cut).split("\n");
  // Front matter (---\nlook: handDrawn\n---) must be complete.
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && lines[first].trim() === "---") {
    const close = lines.findIndex((l, i) => i > first && l.trim() === "---");
    if (close < 0) return "";
    lines = lines.slice(close + 1);
  }
  const head = lines.findIndex((l) => l.trim());
  if (head < 0 || !/^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/.test(lines[head])) return "";
  const body = lines.slice(head + 1).filter((l) => l.trim() && !/^\s*%%/.test(l));
  if (!body.some((l) => !/^\s*(subgraph|end|direction)\b/.test(l))) return "";
  let open = 0;
  for (const l of body) {
    if (/^\s*subgraph\b/.test(l)) open++;
    else if (/^\s*end\s*$/.test(l)) open = Math.max(0, open - 1);
  }
  return [lines[head], ...body, ...Array(open).fill("  end")].join("\n");
}
