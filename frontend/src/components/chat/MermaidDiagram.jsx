import React, { useContext, useEffect, useRef, useState } from "react";
import { Check, Code2, Copy, Download, Network } from "lucide-react";
import { OpenDiagramContext } from "../../lib/mermaidStream";
import "./mermaidDiagram.css";

// Renders a ```mermaid code block as a real diagram (flowcharts, UML use
// case / class / sequence diagrams, ER, state, gantt…), the way Claude.ai
// does. Mermaid is ~1 MB, so it is imported the first time a diagram shows up,
// not with the app.
//
// securityLevel "strict": the diagram source comes from a model, which can be
// steered by web pages it read, so HTML in labels and click handlers stay off.
// Mermaid sanitises the SVG it returns in this mode.

// One explicit font for both measuring and drawing labels. With "inherit",
// Mermaid measured text in one font and the chat drew it in another, so
// labels were clipped ("Book appointmen…").
const DIAGRAM_FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

let mermaidModule = null;
let configuredTheme = null;
// mermaid.render is not safe to run concurrently; queue every render.
let renderQueue = Promise.resolve();
let renderCount = 0;

const THEME_VARIABLES = {
  light: {
    background: "transparent",
    fontFamily: DIAGRAM_FONT,
    fontSize: "15px",
    primaryColor: "#FBF8F3",
    primaryTextColor: "#1F1D1A",
    primaryBorderColor: "#C9B8A3",
    secondaryColor: "#F3ECE3",
    tertiaryColor: "#FFFFFF",
    lineColor: "#7A7066",
    textColor: "#1F1D1A",
    clusterBkg: "#FBF9F6",
    clusterBorder: "#D6CCC0",
    edgeLabelBackground: "#FFFFFF",
    noteBkgColor: "#FFF6E0",
    noteBorderColor: "#E3C98B",
    actorBkg: "#FBF8F3",
    actorBorder: "#C9B8A3",
    signalColor: "#5F564D",
  },
  dark: {
    background: "transparent",
    fontFamily: DIAGRAM_FONT,
    fontSize: "15px",
    darkMode: true,
    primaryColor: "#2E2C29",
    primaryTextColor: "#ECE9E4",
    primaryBorderColor: "#6E655B",
    secondaryColor: "#383531",
    tertiaryColor: "#262422",
    lineColor: "#A79E94",
    textColor: "#ECE9E4",
    clusterBkg: "#1F1E1C",
    clusterBorder: "#4F4943",
    edgeLabelBackground: "#262422",
    noteBkgColor: "#3A3325",
    noteBorderColor: "#7D6A45",
    actorBkg: "#2E2C29",
    actorBorder: "#6E655B",
    signalColor: "#CFC8BF",
  },
};

async function getMermaid(theme) {
  if (!mermaidModule) mermaidModule = import("mermaid").then((m) => m.default);
  const mermaid = await mermaidModule;
  if (configuredTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: THEME_VARIABLES[theme],
      fontFamily: DIAGRAM_FONT,
      flowchart: { htmlLabels: false, curve: "basis", padding: 12, nodeSpacing: 40, rankSpacing: 50 },
    });
    configuredTheme = theme;
  }
  return mermaid;
}

// ─── automatic colours ──────────────────────────────────────────────────────
// Flowcharts and use case diagrams get colour by role, like Claude's
// diagrams: use cases teal, «include» purple, «extend» orange, decisions
// amber, actors neutral. Worked out from each node's shape, so it doesn't
// depend on the model writing styling. A diagram that already has its own
// classDef/style lines is left exactly as written.
const PALETTE = {
  dark: {
    step: "fill:#0E5A48,stroke:#2FB38A,color:#E6FFF6",
    usecase: "fill:#0E5A48,stroke:#2FB38A,color:#E6FFF6",
    include: "fill:#3C2F92,stroke:#8375F0,color:#F1EEFF",
    extend: "fill:#7A2E16,stroke:#E0703A,color:#FFE9DE",
    decision: "fill:#6B4E0E,stroke:#E0A92E,color:#FFF4D6",
    actor: "fill:#3A3835,stroke:#8A837A,color:#ECE9E4",
  },
  light: {
    step: "fill:#D9F2EA,stroke:#1F9D7A,color:#0B4A3A",
    usecase: "fill:#D9F2EA,stroke:#1F9D7A,color:#0B4A3A",
    include: "fill:#E7E3FF,stroke:#6D5BD0,color:#2E236E",
    extend: "fill:#FDE6DA,stroke:#D9652F,color:#6E2A10",
    decision: "fill:#FFF1CC,stroke:#D19B1F,color:#5C420A",
    actor: "fill:#F2EFEA,stroke:#A39A8F,color:#2B2724",
  },
};

// Node ID followed by its opening shape: (( circle, ([ stadium, { rhombus,
// [ or ( box. Covers definitions at line start and after an edge.
const NODE_RE = /(?:^|--+>?|-\.+->?|==+>?|---|&)\s*([A-Za-z_][\w]*)\s*(\(\(|\(\[|\[\[|\[\(|\{\{|\{|\[|\()/gm;

function colorize(code, theme, presetRoles = null) {
  if (!/^\s*(flowchart|graph)\b/m.test(code)) return code;
  if (/^\s*(classDef|style|class)\s/m.test(code)) return code;
  const roles = new Map(presetRoles || []);
  const setRole = (id, role) => { if (!roles.has(id)) roles.set(id, role); };
  // «include» / «extend» targets first, so they win over their plain shape.
  for (const m of code.matchAll(/([A-Za-z_][\w]*)[^\n]*?(«include»|<<include>>|«extend»|<<extend>>)[^\n]*?>\s*([A-Za-z_][\w]*)/g)) {
    if (!roles.has(m[3])) roles.set(m[3], /include/.test(m[2]) ? "include" : "extend");
  }
  for (const m of code.matchAll(NODE_RE)) {
    const [, id, shape] = m;
    if (["subgraph", "end", "flowchart", "graph", "click", "direction"].includes(id)) continue;
    if (shape === "((") setRole(id, "actor");
    else if (shape === "([") setRole(id, "usecase");
    else if (shape === "{" || shape === "{{") setRole(id, "decision");
    else setRole(id, "step");
  }
  if (!roles.size) return code;
  const palette = PALETTE[theme] || PALETTE.light;
  const byRole = {};
  for (const [id, role] of roles) (byRole[role] ||= []).push(id);
  const lines = Object.entries(byRole).flatMap(([role, ids]) => [
    `  classDef vetro_${role} ${palette[role]}`,
    `  class ${ids.join(",")} vetro_${role}`,
  ]);
  return `${code.replace(/\s+$/, "")}\n${lines.join("\n")}\n`;
}

// ─── UML use case look ──────────────────────────────────────────────────────
// Mermaid has no UML use case diagram, so models write one as a flowchart:
// actors as (("👤 Name")) circles, use cases as (["…"]) pills, and «include» /
// «extend» as labels on dashed edges. This turns that into the classic look:
// stick-figure actors, rounded boxes, and the stereotype as a small second
// line inside the included/extending use case.
const RELATION_RE = /(«include»|«extend»|<<include>>|<<extend>>)/;
const ID = "[A-Za-z_][\\w]*";

function isUseCaseDiagram(code) {
  if (!/^\s*(flowchart|graph)\b/m.test(code) || /^\s*(classDef|style|class)\s/m.test(code)) return false;
  return RELATION_RE.test(code) || /\(\(\s*"?\s*👤/.test(code);
}

function toUseCase(code) {
  const actors = new Map(); // id -> name
  const relations = new Map(); // use case id -> "include" | "extend"
  let out = code;
  // Actors: (("👤 Name")) -> a tiny anchor node; the stick figure is drawn over it later.
  out = out.replace(new RegExp(`\\b(${ID})\\(\\(\\s*"?\\s*(?:👤\\s*)?([^")]*?)\\s*"?\\s*\\)\\)`, "g"), (m, id, name) => {
    actors.set(id, name.trim() || id);
    return `${id}@{ shape: sm-circ }`;
  });
  // Relationship edges: drop the edge label, remember the target's stereotype.
  out = out.replace(new RegExp(`^(\\s*)(${ID})\\s*-\\.+\\s*"?\\s*(«include»|«extend»|<<include>>|<<extend>>)\\s*"?\\s*\\.+->\\s*(${ID})`, "gm"), (m, ind, from, rel, to) => {
    relations.set(to, /include/.test(rel) ? "include" : "extend");
    return `${ind}${from} -.-> ${to}`;
  });
  out = out.replace(new RegExp(`^(\\s*)(${ID})\\s*-\\.+->\\s*\\|\\s*"?\\s*(«include»|«extend»|<<include>>|<<extend>>)\\s*"?\\s*\\|\\s*(${ID})`, "gm"), (m, ind, from, rel, to) => {
    relations.set(to, /include/.test(rel) ? "include" : "extend");
    return `${ind}${from} -.-> ${to}`;
  });
  // Use cases: pills -> rounded boxes; related ones get «include»/«extend» as a second line.
  out = out.replace(new RegExp(`(?<!subgraph\\s+)\\b(${ID})\\s*(?:\\(\\[\\s*"([^"]*)"\\s*\\]\\)|\\(\\[([^\\]]*)\\]\\)|\\(\\s*"([^"]*)"\\s*\\)|\\["([^"]*)"\\])`, "g"), (m, id, a, b, c, d) => {
    const label = (a ?? b ?? c ?? d ?? "").trim();
    const rel = relations.get(id);
    return rel ? `${id}("${label}<br/><small>«${rel}»</small>")` : `${id}("${label}")`;
  });
  // Arrowheads from an actor to its use cases, as in UML.
  out = out.replace(new RegExp(`^(\\s*)(${ID})\\s*---\\s*(${ID})\\s*$`, "gm"), (m, ind, a, b) => (actors.has(a) ? `${ind}${a} --> ${b}` : m));
  return { code: out, actors, relations };
}

const FIGURE = {
  dark: { stroke: "#CFC8BF", head: "#4A4744", text: "#E7E2DB", halo: "#262422" },
  light: { stroke: "#5F564D", head: "#E6E1DA", text: "#2B2724", halo: "#FFFFFF" },
};

// Replaces each actor's anchor dot with a stick figure and its name, and
// widens the canvas so names at the edges aren't cut off.
function drawActors(svg, actors, theme) {
  if (!actors.size) return svg;
  // Parsed as HTML: Mermaid's labels contain <br> inside foreignObject, which
  // isn't well-formed XML, and HTML is how the page will read it anyway.
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${svg}</body>`, "text/html");
  const root = doc.body.querySelector("svg");
  if (!root) return svg;
  const NS = "http://www.w3.org/2000/svg";
  const c = FIGURE[theme] || FIGURE.light;
  const el = (tag, attrs) => {
    const node = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  for (const [id, name] of actors) {
    const group = [...root.querySelectorAll("g.node")].find((g) => new RegExp(`-flowchart-${id}-\\d+$`).test(g.id));
    if (!group) continue;
    for (const child of [...group.children]) child.setAttribute("style", "display:none");
    const fig = el("g", { class: "vetro-actor", stroke: c.stroke, "stroke-width": "2", "stroke-linecap": "round", fill: "none" });
    fig.appendChild(el("circle", { cx: "0", cy: "-24", r: "9", fill: c.head }));
    fig.appendChild(el("line", { x1: "0", y1: "-15", x2: "0", y2: "8" }));
    fig.appendChild(el("line", { x1: "-14", y1: "-6", x2: "14", y2: "-6" }));
    fig.appendChild(el("line", { x1: "0", y1: "8", x2: "-11", y2: "24" }));
    fig.appendChild(el("line", { x1: "0", y1: "8", x2: "11", y2: "24" }));
    // A halo in the background colour keeps the name readable if it lands on other text.
    const label = el("text", { x: "0", y: "42", "text-anchor": "middle", fill: c.text, stroke: c.halo, "stroke-width": "4", "paint-order": "stroke", "stroke-linejoin": "round", "font-size": "13", "font-weight": "500", "font-family": DIAGRAM_FONT });
    label.textContent = name;
    fig.appendChild(label);
    group.appendChild(fig);
  }
  // Room for the figures and names that stick out of the anchor dots.
  const vb = (root.getAttribute("viewBox") || "").split(/\s+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite)) {
    const [x, y, w, h] = vb;
    root.setAttribute("viewBox", `${x - 70} ${y - 40} ${w + 140} ${h + 90}`);
    const style = root.getAttribute("style") || "";
    root.setAttribute("style", style.replace(/max-width:\s*[\d.]+px/, `max-width: ${w + 140}px`));
  }
  return root.outerHTML;
}

function renderDiagram(rawCode, theme) {
  const useCase = isUseCaseDiagram(rawCode) ? toUseCase(rawCode) : null;
  const presetRoles = useCase ? [
    ...[...useCase.actors.keys()].map((id) => [id, "actor"]),
    ...useCase.relations.entries(),
  ] : null;
  const code = colorize(useCase ? useCase.code : rawCode, theme, presetRoles);
  const job = renderQueue.then(async () => {
    const mermaid = await getMermaid(theme);
    const id = `vetro-mermaid-${Date.now().toString(36)}-${renderCount++}`;
    try {
      await mermaid.parse(code);
      let { svg } = await mermaid.render(id, code);
      // Mermaid writes <br> as <br></br>, which an HTML parser reads as two breaks.
      svg = svg.replace(/<\/br>/g, "");
      if (useCase) svg = drawActors(svg, useCase.actors, theme);
      return svg;
    } finally {
      // A failed render leaves its scratch element behind in <body>.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  renderQueue = job.catch(() => {});
  return job;
}

// Follows the app's light/dark switch (data-theme on <html>).
function useDocumentTheme() {
  const read = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

const DIAGRAM_NAMES = [
  [/^flowchart|^graph/i, "Flowchart"],
  [/^sequenceDiagram/i, "Sequence diagram"],
  [/^classDiagram/i, "Class diagram"],
  [/^stateDiagram/i, "State diagram"],
  [/^erDiagram/i, "ER diagram"],
  [/^gantt/i, "Gantt chart"],
  [/^mindmap/i, "Mind map"],
  [/^pie/i, "Pie chart"],
  [/^journey/i, "User journey"],
  [/^timeline/i, "Timeline"],
];
const diagramName = (code) => {
  if (/«include»|«extend»|<<include>>|<<extend>>|👤/.test(code) && /^\s*(flowchart|graph)/im.test(code)) return "Use case diagram";
  const first = String(code).trim().split("\n").find((l) => l.trim() && !l.trim().startsWith("%%")) || "";
  return DIAGRAM_NAMES.find(([rx]) => rx.test(first.trim()))?.[1] || "Diagram";
};

export default function MermaidDiagram({ code, fallback = null }) {
  const theme = useDocumentTheme();
  // Still streaming: this block's closing ``` hasn't arrived yet.
  const openDiagram = useContext(OpenDiagramContext);
  const pending = openDiagram != null && openDiagram.trim() === String(code).trim();
  const [state, setState] = useState({ status: "idle", svg: "", error: "" });
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const svgRef = useRef(null);

  useEffect(() => {
    if (pending || !code.trim()) return undefined;
    let alive = true;
    renderDiagram(code, theme)
      .then((svg) => { if (alive) setState({ status: "ready", svg, error: "" }); })
      .catch((err) => { if (alive) setState({ status: "error", svg: "", error: String(err?.message || err || "Invalid diagram").split("\n")[0] }); });
    return () => { alive = false; };
  }, [code, theme, pending]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  const download = () => {
    if (!state.svg) return;
    const url = URL.createObjectURL(new Blob([state.svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${diagramName(code).toLowerCase().replace(/\s+/g, "-")}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Mid-stream: the closing ``` hasn't arrived, so the syntax is incomplete.
  if (pending) {
    return (
      <div className="vetro-diagram not-prose">
        <div className="vetro-diagram-pending"><Network size={16} /> Drawing diagram…</div>
      </div>
    );
  }

  // Not valid Mermaid: show the code as a normal code block instead.
  if (state.status === "error") {
    return (
      <div className="vetro-diagram-fallback not-prose">
        <div className="vetro-diagram-error">Couldn’t draw this diagram ({state.error}). Showing the code instead.</div>
        {fallback}
      </div>
    );
  }

  return (
    <div className="vetro-diagram not-prose">
      <div className="vetro-diagram-head">
        <span className="vetro-diagram-title"><Network size={14} /> {diagramName(code)}</span>
        <span className="vetro-diagram-actions">
          <button type="button" onClick={() => setShowCode((v) => !v)} title={showCode ? "Show diagram" : "Show Mermaid code"} aria-label={showCode ? "Show diagram" : "Show Mermaid code"}>
            {showCode ? <><Network size={14} /><span className="vetro-diagram-btn-label">Diagram</span></> : <><Code2 size={14} /><span className="vetro-diagram-btn-label">Code</span></>}
          </button>
          <button type="button" onClick={copy} title="Copy Mermaid code" aria-label="Copy Mermaid code">
            {copied ? <><Check size={14} /><span className="vetro-diagram-btn-label">Copied</span></> : <><Copy size={14} /><span className="vetro-diagram-btn-label">Copy</span></>}
          </button>
          <button type="button" onClick={download} disabled={!state.svg} title="Download as SVG" aria-label="Download as SVG">
            <Download size={14} /><span className="vetro-diagram-btn-label">SVG</span>
          </button>
        </span>
      </div>
      {showCode ? (
        <pre className="vetro-diagram-code"><code>{code}</code></pre>
      ) : state.svg ? (
        <div ref={svgRef} className="vetro-diagram-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
      ) : (
        <div className="vetro-diagram-pending"><Network size={16} /> Drawing diagram…</div>
      )}
    </div>
  );
}
