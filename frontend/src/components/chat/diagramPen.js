// Draws a flowchart the way a hand would, so the user watches it being made:
// a box, the arrow out of it, the next box — each line traced by a pen. The
// diagram is re-rendered as more of it streams in; what has been drawn stays,
// and only the new boxes and arrows are drawn (`drawn` survives re-renders).

const GEOMETRY = "path, rect, circle, ellipse, polygon, polyline, line";
const PEN_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21l1.2-4.6L16.6 4a2.1 2.1 0 0 1 3 0l.4.4a2.1 2.1 0 0 1 0 3L7.6 19.8z" fill="#f5c542" stroke="#1d1b18" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 21l1.2-4.6 3.4 3.4z" fill="#f2dcc0" stroke="#1d1b18" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 21l.5-1.9 1.4 1.4z" fill="#1d1b18"/><path d="M14.6 6l3.4 3.4" stroke="#1d1b18" stroke-width="1.3"/></svg>';

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
// Mermaid writes "0 0" on solid lines; only real gaps make a dashed line.
const isDashed = (v) => (String(v || "").match(/[\d.]+/g) || []).some((n) => parseFloat(n) > 0);
const lengthOf = (el) => { try { return el.getTotalLength(); } catch { return 0; } };

// Boxes and arrows of a Mermaid flowchart, keyed so the same box is known in
// the next render, in the order a person would draw them.
function planOf(svg) {
  const prefix = `${svg.id}-`;
  const nodes = new Map();
  svg.querySelectorAll("g.nodes > g").forEach((g) => {
    const id = g.id.startsWith(prefix) ? g.id.slice(prefix.length) : g.id;
    const name = id.match(/^flowchart-(.+)-\d+$/)?.[1];
    if (name) nodes.set(name, g);
  });
  if (!nodes.size) return null;
  const labels = new Map();
  svg.querySelectorAll("g.edgeLabel g.label[data-id]").forEach((l) => labels.set(l.getAttribute("data-id"), l.closest("g.edgeLabel")));
  const items = [];
  const seen = new Set();
  const add = (key, el, kind, extra) => { if (el && !seen.has(key)) { seen.add(key); items.push({ key, el, kind, ...extra }); } };
  svg.querySelectorAll("g.clusters > g.cluster").forEach((c) => add(`c:${c.id.slice(prefix.length)}`, c, "shape"));
  svg.querySelectorAll("g.edgePaths > path[data-id]").forEach((p) => {
    const id = p.getAttribute("data-id");
    // L_<from>_<to>_<n>; names can hold underscores, so try each split.
    const parts = id.replace(/^L_/, "").replace(/_\d+$/, "").split("_");
    let from = null, to = null;
    for (let i = 1; i < parts.length; i++) {
      const a = parts.slice(0, i).join("_"), b = parts.slice(i).join("_");
      if (nodes.has(a) && nodes.has(b)) { from = a; to = b; break; }
    }
    if (from) add(`n:${from}`, nodes.get(from), "shape");
    add(`e:${id}`, p, "line", { label: labels.get(id) });
    if (to) add(`n:${to}`, nodes.get(to), "shape");
  });
  nodes.forEach((g, name) => add(`n:${name}`, g, "shape"));
  return items;
}

export function createPen(stage, drawn) {
  const pen = document.createElement("div");
  pen.className = "vd-pen";
  pen.innerHTML = PEN_SVG;
  stage.appendChild(pen);
  let queue = [];
  let raf = 0;
  let timer = 0;

  const movePen = (geom, at) => {
    try {
      const pt = geom.getPointAtLength(at).matrixTransform(geom.getScreenCTM());
      const box = stage.getBoundingClientRect();
      pen.style.transform = `translate(${pt.x - box.left}px, ${pt.y - box.top - 26}px)`;
      pen.classList.add("is-on");
    } catch { /* element left the page */ }
  };

  const reveal = (el) => { el.style.opacity = ""; };

  const play = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    const item = queue.shift();
    if (!item) { pen.classList.remove("is-on"); return; }
    if (!item.el.isConnected) { play(); return; }
    // Behind the stream? Draw faster.
    const k = queue.length > 10 ? 0.35 : queue.length > 5 ? 0.6 : 1;
    const el = item.el;
    reveal(el);
    const geoms = (item.kind === "line" ? [el] : [...el.querySelectorAll(GEOMETRY)])
      .map((g) => ({ g, len: lengthOf(g), cs: getComputedStyle(g) }))
      .filter(({ len }) => len > 0);
    const texts = item.kind === "shape" ? [...el.querySelectorAll("text, foreignObject, .label")] : [];
    texts.forEach((t) => { t.style.transition = "none"; t.style.opacity = "0"; });
    const traced = [];
    geoms.forEach(({ g, len, cs }) => {
      // Dashed lines keep their dashes: they fade in instead.
      if (isDashed(cs.strokeDasharray)) { g.style.opacity = "0"; traced.push({ g, len, fade: true }); return; }
      const markers = ["marker-start", "marker-end"].map((a) => [a, g.getAttribute(a)]).filter(([, v]) => v);
      markers.forEach(([a]) => g.removeAttribute(a));
      g.style.strokeDasharray = `${len}`;
      g.style.strokeDashoffset = `${len}`;
      g.style.fillOpacity = "0";
      traced.push({ g, len, markers });
    });
    // The pen follows the outline: the shortest line of any size (a sketch's
    // hatching is one long path).
    const lead = traced.filter((t) => !t.fade && t.len > 30).sort((a, b) => a.len - b.len)[0] || traced.find((t) => !t.fade);
    const duration = Math.max(260, Math.min(900, (lead?.len || 200) / 1.1)) * k;
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = ease(t);
      traced.forEach(({ g, len, fade }) => { if (fade) g.style.opacity = String(e); else g.style.strokeDashoffset = `${len * (1 - e)}`; });
      if (lead) movePen(lead.g, lead.len * e);
      if (t < 1) { raf = requestAnimationFrame(frame); return; }
      traced.forEach(({ g, markers }) => {
        g.style.strokeDasharray = ""; g.style.strokeDashoffset = ""; g.style.opacity = "";
        g.style.transition = "fill-opacity .3s ease"; g.style.fillOpacity = "";
        markers?.forEach(([a, v]) => g.setAttribute(a, v));
      });
      texts.forEach((x) => { x.style.transition = "opacity .3s ease"; x.style.opacity = ""; });
      if (item.label) { item.label.style.transition = "opacity .3s ease"; reveal(item.label); }
      drawn.add(item.key);
      timer = setTimeout(play, 60 * k);
    };
    raf = requestAnimationFrame(frame);
  };

  return {
    // Takes the freshly rendered diagram; false when it isn't a flowchart.
    update(host) {
      const svg = host.querySelector("svg");
      const items = svg && planOf(svg);
      if (!items) return false;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        items.forEach((it) => drawn.add(it.key));
        return true;
      }
      queue = items.filter((it) => !drawn.has(it.key));
      queue.forEach((it) => { it.el.style.opacity = "0"; if (it.label) it.label.style.opacity = "0"; });
      play();
      return true;
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      pen.remove();
    },
    stage,
  };
}
