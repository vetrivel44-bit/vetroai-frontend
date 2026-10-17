import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, Copy, Download, Maximize2, Network, PenLine, Shapes } from "lucide-react";
import { OpenBlockContext, isStillStreaming } from "../../lib/visualStream";
import "./mermaidDiagram.css";
// The handwriting font ships with the app (not from Google Fonts), so a
// hand-drawn diagram always measures and draws its labels in the same font.
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import { PendingSketch } from "./visuals/VisualCard";
import { useBornLive } from "../../lib/streamReveal";
import DiagramViewer from "./DiagramViewer";
import { RELATION_RE, isUseCaseDiagram, diagramName } from "../../lib/diagramKinds";
import { alignSubgraphs, drawablePrefix, stripModelStyling, wantsHandDrawn } from "../../lib/mermaidCode";
import { createPen, penSession as getPenSession } from "./diagramPen";

// ─── draw-in reveal ─────────────────────────────────────────────────────────
// A diagram that arrives during a reply is revealed the way it would be
// sketched: shapes appear one after another, then each connector draws itself
// along its path. Only the live copy animates — the SVG string that is copied
// or downloaded is untouched.
const SHAPES = [
  "g.node", "g.cluster", ".actor", "g.note", ".labelBox", ".task", ".taskText",
  ".pieCircle", ".legend", ".mindmap-node", ".section", ".er.entityBox", ".statediagram-state",
].join(",");
const CONNECTORS = [
  "path.flowchart-link", ".edgePaths path", "path.relation", ".relationshipLine",
  "path.transition", "line[class^='messageLine']", ".messageText", ".edgeLabel", ".loopLine",
].join(",");

function revealDiagram(host) {
  const svg = host?.querySelector("svg");
  if (!svg) return () => {};
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  const shapes = [...svg.querySelectorAll(SHAPES)].filter((el) => !el.closest(".vd-shape"));
  const shapeStep = Math.min(70, 900 / Math.max(1, shapes.length));
  shapes.forEach((el, i) => {
    el.classList.add("vd-shape");
    el.style.animationDelay = `${Math.round(i * shapeStep)}ms`;
  });
  const start = shapes.length ? Math.min(500, shapes.length * shapeStep * 0.6) : 0;
  const lines = [...svg.querySelectorAll(CONNECTORS)];
  const lineStep = Math.min(60, 800 / Math.max(1, lines.length));
  const cleanups = [];
  lines.forEach((el, i) => {
    const delay = Math.round(start + i * lineStep);
    const dashed = getComputedStyle(el).strokeDasharray;
    // A dashed connector (-.->) keeps its dashes: it fades in instead.
    if (typeof el.getTotalLength === "function" && (!dashed || dashed === "none")) {
      const len = el.getTotalLength();
      if (len > 0) {
        el.style.strokeDasharray = `${len}`;
        el.style.strokeDashoffset = `${len}`;
        el.style.animation = `vdDraw 0.75s cubic-bezier(0.65, 0, 0.35, 1) ${delay}ms forwards, vdFade 0.3s ease ${delay}ms both`;
        const done = () => { el.style.strokeDasharray = ""; el.style.strokeDashoffset = ""; el.style.animation = ""; };
        el.addEventListener("animationend", (e) => { if (e.animationName === "vdDraw") done(); });
        cleanups.push(done);
        return;
      }
    }
    el.style.animation = `vdFade 0.45s ease ${delay}ms both`;
    cleanups.push(() => { el.style.animation = ""; });
  });
  if (!shapes.length && !lines.length) svg.classList.add("vd-whole");
  return () => cleanups.forEach((fn) => fn());
}

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
// Hand-drawn diagrams ("```mermaid sketch") are lettered like notes in an
// exercise book. Kalam is bundled with the app (@fontsource/kalam).
const SKETCH_FONT = '"Kalam", "Patrick Hand", "Comic Sans MS", cursive';


let mermaidModule = null;
let configuredKey = null;
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

async function getMermaid(theme, sketch = false) {
  if (!mermaidModule) mermaidModule = import("mermaid").then((m) => m.default);
  const mermaid = await mermaidModule;
  const key = `${theme}:${sketch ? "sketch" : "clean"}`;
  if (configuredKey !== key) {
    const font = sketch ? SKETCH_FONT : DIAGRAM_FONT;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      look: sketch ? "handDrawn" : "classic",
      // A fixed seed: the same diagram wobbles the same way every time it is drawn.
      handDrawnSeed: 7,
      themeVariables: { ...THEME_VARIABLES[theme], ...(sketch ? SKETCH_INK[theme] : {}), fontFamily: font, fontSize: sketch ? "16px" : "15px" },
      fontFamily: font,
      // Handwriting runs wider and less evenly than Inter: more room around labels.
      flowchart: { htmlLabels: false, curve: "basis", padding: sketch ? 20 : 12, nodeSpacing: sketch ? 46 : 40, rankSpacing: 50, subGraphTitleMargin: { top: 10, bottom: 6 } },
    });
    configuredKey = key;
  }
  return mermaid;
}

// Mermaid sizes boxes by measuring the label text, so the handwriting font
// must be ready first or labels overflow their boxes.
async function sketchFontReady() {
  if (!document.fonts?.load) return;
  await Promise.race([
    Promise.all([document.fonts.load('400 16px "Kalam"'), document.fonts.load('700 16px "Kalam"')]),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]).catch(() => {});
}

// ─── automatic colours ──────────────────────────────────────────────────────
// Flowcharts and use case diagrams get colour by role, like Claude's
// diagrams: use cases teal, «include» purple, «extend» orange, decisions
// amber, actors neutral. Worked out from each node's shape, so it doesn't
// depend on the model writing styling; any styling it did write is removed
// first (stripModelStyling), so the colours always suit the theme.
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

// Hand-drawn diagrams fill shapes with hatching in the fill colour, so their
// fills are soft highlighter tones that sit behind the handwriting, with
// strong ink outlines and text — like a well-kept exercise book.
// Only fill and text colour: a classDef stroke would also recolour the
// hatching (it is a stroked path), so outlines come from the theme's ink
// colour instead (SKETCH_INK).
const SKETCH_PALETTE = {
  dark: {
    step: "fill:#24574A,color:#F2FFF9",
    usecase: "fill:#24574A,color:#F2FFF9",
    include: "fill:#3E3780,color:#F5F3FF",
    extend: "fill:#6E3B28,color:#FFF1EA",
    decision: "fill:#6A531C,color:#FFF8E6",
    actor: "fill:#3F3C39,color:#F2EFEA",
  },
  light: {
    step: "fill:#CDEFE3,color:#12382E",
    usecase: "fill:#CDEFE3,color:#12382E",
    include: "fill:#E3DEFF,color:#241D5C",
    extend: "fill:#FFDCCB,color:#4E1F0B",
    decision: "fill:#FFEBB0,color:#3F2E06",
    actor: "fill:#EFEAE2,color:#2B2724",
  },
};
const SKETCH_INK = {
  dark: { primaryBorderColor: "#D9D2C8", lineColor: "#CFC8BF", clusterBorder: "#8A8279", actorBorder: "#D9D2C8" },
  light: { primaryBorderColor: "#3A332C", lineColor: "#4F4842", clusterBorder: "#8A8279", actorBorder: "#3A332C" },
};

// Node ID followed by its opening shape: (( circle, ([ stadium, { rhombus,
// [ or ( box. Covers definitions at line start and after an edge.
const NODE_RE = /(?:^|--+>?|-\.+->?|==+>?|---|&)\s*([A-Za-z_][\w]*)\s*(\(\(|\(\[|\[\[|\[\(|\{\{|\{|\[|\()/gm;

function colorize(code, theme, presetRoles = null, sketch = false) {
  if (!/^\s*(flowchart|graph)\b/m.test(code)) return code;
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
  const palettes = sketch ? SKETCH_PALETTE : PALETTE;
  const palette = palettes[theme] || palettes.light;
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
const ID = "[A-Za-z_][\\w]*";


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

function renderDiagram(rawCode, theme, sketch = false) {
  const useCase = isUseCaseDiagram(rawCode) ? toUseCase(stripModelStyling(rawCode)) : null;
  const presetRoles = useCase ? [
    ...[...useCase.actors.keys()].map((id) => [id, "actor"]),
    ...useCase.relations.entries(),
  ] : null;
  const clean = alignSubgraphs(stripModelStyling(rawCode));
  const code = colorize(useCase ? useCase.code : clean, theme, presetRoles, sketch);
  const job = renderQueue.then(async () => {
    if (sketch) await sketchFontReady();
    const mermaid = await getMermaid(theme, sketch);
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


const penKey = (code) => {
  const lines = String(code || "").split("\n");
  const whole = lines.slice(0, -1).map((l) => l.trim()).filter(Boolean);
  return whole.length >= 2 ? whole.slice(0, 2).join("\n").slice(0, 200) : "";
};

export default function MermaidDiagram({ code, fallback = null, sketch: sketchByDefault = false }) {
  const theme = useDocumentTheme();
  // Hand-drawn when the block asked for it; either look can be switched to.
  // (Follows the block until switched: while it streams, the "sketch" tag can
  // arrive after the first render.)
  const [chosenLook, setSketch] = useState(null);
  const sketch = chosenLook ?? (sketchByDefault || wantsHandDrawn(code));
  // Still streaming: this block's closing ``` hasn't arrived yet.
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const [state, setState] = useState({ status: "idle", svg: "", error: "" });
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const svgRef = useRef(null);
  // Born during a reply: draw it in once when it is ready.
  const bornLive = useBornLive();
  const revealed = useRef(false);
  // Too wide to read at the chat's width (labels under ~11px): offer the
  // full-screen viewer.
  const [tooSmall, setTooSmall] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The pen that draws a flowchart in front of the user, and what it has drawn.
  const stageRef = useRef(null);
  const penRef = useRef(null);
  // The chat swaps its live copy of a reply for the finished one when it ends,
  // so what the pen has drawn is kept by diagram, not by this component.
  const sessionKey = penKey(code);
  const penSession = useMemo(() => getPenSession(sessionKey, bornLive), [sessionKey, bornLive]);
  useEffect(() => () => { penRef.current?.destroy(); penRef.current = null; }, []);

  // While the block streams, draw what is written so far: the flowchart grows
  // box by box instead of waiting for the whole block.
  const partial = pending && penSession ? drawablePrefix(code) : "";
  useEffect(() => {
    if (!partial) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      renderDiagram(partial, theme, sketch)
        .then((svg) => { if (alive) setState({ status: "ready", svg, error: "" }); })
        .catch(() => { /* half-written: wait for the next line */ });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [partial, theme, sketch]);

  useEffect(() => {
    if (pending || !code.trim()) return undefined;
    let alive = true;
    renderDiagram(code, theme, sketch)
      .then((svg) => { if (alive) setState({ status: "ready", svg, error: "" }); })
      .catch((err) => { if (alive) setState({ status: "error", svg: "", error: String(err?.message || err || "Invalid diagram").split("\n")[0] }); });
    return () => { alive = false; };
  }, [code, theme, pending, sketch]);

  // The SVG is put in once per finished render, not through
  // dangerouslySetInnerHTML: that re-inserted it on every streamed token (the
  // reply re-renders this component ~30 times a second), rebuilding the
  // diagram each time and wiping the draw-in. Mermaid's strict mode has
  // already sanitised it.
  useLayoutEffect(() => {
    const host = svgRef.current;
    if (!host || !state.svg) return;
    host.innerHTML = state.svg;
    if (penSession) {
      const stage = stageRef.current;
      if (stage && penRef.current?.stage !== stage) {
        penRef.current?.destroy();
        penRef.current = createPen(stage, penSession);
      }
      // A flowchart is drawn by the pen; other diagrams get the quick draw-in.
      const penned = penRef.current?.update(host);
      if (!penned && bornLive && !revealed.current) {
        revealed.current = true;
        revealDiagram(host);
      }
    }
    // Mermaid draws labels at 15px; below ~0.72 scale they are unreadable.
    const measure = () => {
      const svg = host.querySelector("svg");
      const vb = svg?.viewBox?.baseVal;
      if (!vb?.width) return;
      setTooSmall(svg.getBoundingClientRect().width / vb.width < 0.72);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(host);
    return () => ro?.disconnect();
  }, [bornLive, penSession, state.svg, showCode]);

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

  // Mid-stream with nothing drawable yet (the closing ``` hasn't arrived).
  if (pending && !state.svg) {
    return (
      <div className="vetro-diagram vetro-pending not-prose vetro-born-live">
        <div className="vetro-diagram-pending">
          <PendingSketch kind="diagram" />
          <span className="vetro-pending-label"><Network size={15} /> Drawing diagram<span className="vetro-dots" aria-hidden="true" /></span>
        </div>
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
    <div className={`vetro-diagram not-prose${bornLive ? " vetro-born-live" : ""}${sketch ? " is-sketch" : ""}`}>
      <div className="vetro-diagram-head">
        <span className="vetro-diagram-title">{sketch ? <PenLine size={14} /> : <Network size={14} />} {pending ? <>Drawing<span className="vetro-dots" aria-hidden="true" /></> : <>{diagramName(code)}{sketch ? " · hand-drawn" : ""}</>}</span>
        <span className="vetro-diagram-actions">
          <button type="button" onClick={() => setSketch(!sketch)} title={sketch ? "Clean diagram" : "Hand-drawn diagram"} aria-label={sketch ? "Show as a clean diagram" : "Show as a hand-drawn diagram"} aria-pressed={sketch}>
            {sketch ? <><Shapes size={14} /><span className="vetro-diagram-btn-label">Clean</span></> : <><PenLine size={14} /><span className="vetro-diagram-btn-label">Sketch</span></>}
          </button>
          <button type="button" onClick={() => setShowCode((v) => !v)} title={showCode ? "Show diagram" : "Show Mermaid code"} aria-label={showCode ? "Show diagram" : "Show Mermaid code"}>
            {showCode ? <><Network size={14} /><span className="vetro-diagram-btn-label">Diagram</span></> : <><Code2 size={14} /><span className="vetro-diagram-btn-label">Code</span></>}
          </button>
          <button type="button" onClick={copy} title="Copy Mermaid code" aria-label="Copy Mermaid code">
            {copied ? <><Check size={14} /><span className="vetro-diagram-btn-label">Copied</span></> : <><Copy size={14} /><span className="vetro-diagram-btn-label">Copy</span></>}
          </button>
          <button type="button" onClick={download} disabled={!state.svg} title="Download as SVG" aria-label="Download as SVG">
            <Download size={14} /><span className="vetro-diagram-btn-label">SVG</span>
          </button>
          <button type="button" onClick={() => setExpanded(true)} disabled={!state.svg} title="Full screen" aria-label="Expand diagram">
            <Maximize2 size={14} /><span className="vetro-diagram-btn-label">Expand</span>
          </button>
        </span>
      </div>
      {showCode ? (
        <pre className="vetro-diagram-code"><code>{code}</code></pre>
      ) : state.svg ? (
        <div className="vetro-diagram-stage" ref={stageRef}>
          <div
            ref={svgRef}
            className={`vetro-diagram-svg${bornLive ? " vd-live" : ""}${tooSmall ? " is-too-small" : ""}`}
            onClick={tooSmall ? () => setExpanded(true) : undefined}
          />
          {tooSmall && (
            <button type="button" className="vetro-diagram-zoom-pill" onClick={() => setExpanded(true)}>
              <Maximize2 size={13} /> Tap to zoom
            </button>
          )}
        </div>
      ) : (
        <div className="vetro-diagram-pending">
          <PendingSketch kind="diagram" />
          <span className="vetro-pending-label"><Network size={15} /> Drawing diagram<span className="vetro-dots" aria-hidden="true" /></span>
        </div>
      )}
      {expanded && state.svg && <DiagramViewer svg={state.svg} title={diagramName(code)} onClose={() => setExpanded(false)} />}
    </div>
  );
}
