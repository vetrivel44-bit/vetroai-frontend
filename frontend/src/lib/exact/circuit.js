import { parseLooseJson } from "../looseJson.js";
import { INK, clean, line, poly, r2, sheet, text } from "./svg.js";

// ```circuit — a circuit diagram laid out from how its parts are joined: a
// list in series, ["parallel", …] for branches side by side (a voltmeter is
// a branch across what it measures). Each part gets its standard symbol and
// the wires, corners and junction dots are placed by the app, so a "bulb in
// parallel with a resistor" is always drawn that way.

const KINDS = {
  cell: /^(cell|dry cell)$/, battery: /^(battery|batteries)$/, resistor: /^(resistor|resistance|r)$/,
  rheostat: /^(rheostat|variable resistor|potentiometer)$/, bulb: /^(bulb|lamp|light ?bulb|filament lamp)$/,
  switch: /^(switch|tap key)$/, key: /^(key|plug key)$/, ammeter: /^(ammeter|a)$/, voltmeter: /^(voltmeter|v)$/,
  galvanometer: /^(galvanometer|g)$/, diode: /^(diode)$/, led: /^(led|light emitting diode)$/,
  capacitor: /^(capacitor|condenser)$/, fuse: /^(fuse)$/, motor: /^(motor|m)$/, bell: /^(bell|buzzer)$/,
  ac: /^(ac|ac source|ac supply|alternating|ac generator|mains)$/, wire: /^(wire|connecting wire)$/,
};
const kindOf = (s) => Object.keys(KINDS).find((k) => KINDS[k].test(String(s || "").trim().toLowerCase()));
const SOURCES = new Set(["cell", "battery", "ac"]);

// One part, a series list or a parallel group, from however it was written.
function readNode(item, depth = 0) {
  if (depth > 8 || item == null) return null;
  if (Array.isArray(item)) {
    const head = String(item[0] ?? "").toLowerCase();
    if (head === "series" || head === "parallel") {
      const parts = item.slice(1).map((x) => readNode(x, depth + 1)).filter(Boolean);
      return parts.length ? { group: head, parts } : null;
    }
    const parts = item.map((x) => readNode(x, depth + 1)).filter(Boolean);
    return parts.length ? { group: "series", parts } : null;
  }
  if (typeof item === "string") {
    const kind = kindOf(item);
    return kind ? { kind, label: "" } : null;
  }
  if (typeof item === "object") {
    if (Array.isArray(item.series)) return readNode(["series", ...item.series], depth);
    if (Array.isArray(item.parallel)) return readNode(["parallel", ...item.parallel], depth);
    let kind = kindOf(item.type ?? item.kind ?? item.part ?? item.component);
    let label = item.label ?? item.name ?? item.value ?? "";
    if (!kind) {
      const key = Object.keys(item).find((k) => kindOf(k));
      if (key) { kind = kindOf(key); if (typeof item[key] === "string" || typeof item[key] === "number") label = item[key]; }
    }
    if (!kind) return null;
    return { kind, label: clean(label, 24), open: /open|off/i.test(String(item.state ?? item.status ?? "")), cells: Math.max(1, Math.min(6, Number(item.cells) || (kind === "battery" ? 2 : 1))) };
  }
  return null;
}

export function parseCircuit(input) {
  let raw = null;
  try { raw = parseLooseJson(String(input || "")); } catch { raw = null; }
  if (raw == null || typeof raw !== "object") return { error: "The circuit's description isn't readable." };
  const body = Array.isArray(raw) ? raw : raw.circuit ?? raw.series ?? raw.parts ?? raw.components;
  const root = Array.isArray(raw.parallel) && !body ? readNode(["parallel", ...raw.parallel]) : readNode(body);
  if (!root) return { error: "The circuit has no parts to draw." };
  const top = root.group === "series" ? root : { group: "series", parts: [root] };
  const style = /iec|box|rect/i.test(String(raw.style ?? raw.resistorStyle ?? "")) ? "iec" : "zigzag";
  return { spec: { title: clean(raw.title ?? "Circuit diagram", 70), root: top, style, current: Boolean(raw.current ?? raw.showCurrent) } };
}

// ----- symbols: each centred on (0, 0), the wire coming in at x = -30 and
// going out at x = +30 -----

const S = `stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
const at = (x, y, body) => `<g transform="translate(${r2(x)} ${r2(y)})">${body}</g>`;
const meter = (letter) => `<circle r="13" ${S} fill="#fff"/>${text(0, 5, letter, `font-size="15" font-weight="700" text-anchor="middle" fill="${INK}"`)}${line([-30, 0], [-13, 0], S)}${line([13, 0], [30, 0], S)}`;

function symbol(node, style) {
  switch (node.kind) {
    case "resistor":
    case "rheostat": {
      let body = style === "iec"
        ? `<rect x="-18" y="-7" width="36" height="14" ${S} fill="#fff"/>`
        : poly([[-18, 0], [-15, -7], [-9, 7], [-3, -7], [3, 7], [9, -7], [15, 7], [18, 0]], S);
      body += line([-30, 0], [-18, 0], S) + line([18, 0], [30, 0], S);
      if (node.kind === "rheostat") body += line([-14, 12], [14, -12], S) + poly([[14, -12], [7, -10], [12, -5]], `fill="${INK}" stroke="none"`, true);
      return body;
    }
    case "bulb":
      return `<circle r="13" ${S} fill="#fff"/>${line([-9.2, -9.2], [9.2, 9.2], S)}${line([-9.2, 9.2], [9.2, -9.2], S)}${line([-30, 0], [-13, 0], S)}${line([13, 0], [30, 0], S)}`;
    case "cell":
    case "battery": {
      const n = node.kind === "battery" ? node.cells : 1;
      const gap = 10;
      const w = (n - 1) * gap + 6;
      let body = line([-30, 0], [-w / 2, 0], S) + line([w / 2, 0], [30, 0], S);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + i * gap;
        body += line([x, -14], [x, 14], `stroke="${INK}" stroke-width="1.6"`) + line([x + 6, -7], [x + 6, 7], `stroke="${INK}" stroke-width="4"`);
        if (i < n - 1) body += line([x + 6, 0], [x + gap, 0], `stroke="${INK}" stroke-width="1.4" stroke-dasharray="2 2"`);
      }
      body += text(-w / 2 - 6, -12, "+", `font-size="12" text-anchor="middle" fill="${INK}"`) + text(w / 2 + 6, -10, "−", `font-size="12" text-anchor="middle" fill="${INK}"`);
      return body;
    }
    case "switch":
    case "key": {
      let body = line([-30, 0], [-14, 0], S) + line([14, 0], [30, 0], S);
      body += `<circle cx="-14" r="2.6" fill="${INK}"/><circle cx="14" r="2.6" fill="${INK}"/>`;
      body += node.open ? line([-14, 0], [12, -13], S) : line([-14, 0], [14, -1.5], S);
      return body;
    }
    case "ammeter": return meter("A");
    case "voltmeter": return meter("V");
    case "galvanometer": return meter("G");
    case "motor": return meter("M");
    case "diode":
    case "led": {
      let body = poly([[-9, -10], [-9, 10], [9, 0]], `fill="${INK}" stroke="${INK}" stroke-width="1.5"`, true) + line([9, -10], [9, 10], S);
      body += line([-30, 0], [-9, 0], S) + line([9, 0], [30, 0], S);
      if (node.kind === "led") body += line([2, -13], [9, -21], `stroke="${INK}" stroke-width="1.4"`) + line([8, -12], [15, -20], `stroke="${INK}" stroke-width="1.4"`);
      return body;
    }
    case "capacitor":
      return line([-30, 0], [-4, 0], S) + line([4, 0], [30, 0], S) + line([-4, -12], [-4, 12], S) + line([4, -12], [4, 12], S);
    case "fuse":
      return `<rect x="-14" y="-6" width="28" height="12" ${S} fill="#fff"/>` + line([-30, 0], [30, 0], `stroke="${INK}" stroke-width="1.4"`);
    case "bell":
      return line([-30, 0], [-12, 0], S) + line([12, 0], [30, 0], S) + `<path d="M-12 0A12 12 0 0 1 12 0Z" ${S} fill="#fff"/>`;
    case "ac":
      return `<circle r="13" ${S} fill="#fff"/><path d="M-7 0C-5 -8 -1 -8 0 0S5 8 7 0" ${S}/>${line([-30, 0], [-13, 0], S)}${line([13, 0], [30, 0], S)}`;
    default:
      return line([-30, 0], [30, 0], S);
  }
}

// ----- layout: every node knows its width, height, and where its wire runs
// (`mid`, from its top) -----

const PART_W = 60;
const GAP = 22;
const BRANCH_GAP = 26;
const LEAD = 22;

function measure(node) {
  if (!node.group) {
    const labelled = Boolean(node.label);
    return { ...node, w: PART_W, h: labelled ? 60 : 44, mid: labelled ? 38 : 22 };
  }
  const parts = node.parts.map(measure);
  if (node.group === "series") {
    const w = parts.reduce((s, p) => s + p.w, 0) + GAP * (parts.length - 1);
    const mid = Math.max(...parts.map((p) => p.mid));
    const h = mid + Math.max(...parts.map((p) => p.h - p.mid));
    return { group: "series", parts, w, h, mid };
  }
  const w = Math.max(...parts.map((p) => p.w)) + 2 * LEAD;
  const h = parts.reduce((s, p) => s + p.h, 0) + BRANCH_GAP * (parts.length - 1);
  return { group: "parallel", parts, w, h, mid: parts[0].mid };
}

function draw(node, x, y, style, out, dots) {
  const wireY = y + node.mid;
  if (!node.group) {
    out.push(at(x + node.w / 2, wireY, symbol(node, style)));
    if (node.label) out.push(text(x + node.w / 2, wireY - 22, node.label, `font-size="12.5" text-anchor="middle" fill="${INK}"`));
    return;
  }
  if (node.group === "series") {
    let cx = x;
    node.parts.forEach((p, i) => {
      const py = wireY - p.mid;
      draw(p, cx, py, style, out, dots);
      cx += p.w;
      if (i < node.parts.length - 1) out.push(line([cx, wireY], [cx + GAP, wireY], S));
      cx += GAP;
    });
    return;
  }
  // Parallel: branches one under another between two junctions.
  let by = y;
  const left = x + LEAD / 2;
  const right = x + node.w - LEAD / 2;
  const levels = [];
  for (const p of node.parts) {
    const bw = p.w;
    const bx = x + (node.w - bw) / 2;
    const level = by + p.mid;
    levels.push(level);
    draw(p, bx, by, style, out, dots);
    out.push(line([left, level], [bx, level], S), line([bx + bw, level], [right, level], S));
    by += p.h + BRANCH_GAP;
  }
  out.push(line([left, levels[0]], [left, levels[levels.length - 1]], S));
  out.push(line([right, levels[0]], [right, levels[levels.length - 1]], S));
  out.push(line([x, wireY], [left, wireY], S), line([right, wireY], [x + node.w, wireY], S));
  dots.push([left, wireY], [right, wireY]);
}

/** A ```circuit block → `{ title, svg, width, height }` or `{ error }`. */
export function renderCircuit(code) {
  const { spec, error } = parseCircuit(code);
  if (error) return { error };
  // The source (cell, battery) goes on the bottom wire, as in a textbook.
  const parts = spec.root.parts;
  const sources = parts.filter((p) => !p.group && SOURCES.has(p.kind));
  const rest = parts.filter((p) => !sources.includes(p));
  const topNode = measure({ group: "series", parts: rest.length ? rest : [{ kind: "wire", label: "" }] });
  const bottomNode = sources.length ? measure({ group: "series", parts: sources }) : null;
  const margin = 34;
  const innerW = Math.max(topNode.w, (bottomNode?.w || 0) + 120) + 2 * 40;
  const topY = margin;
  const topWire = topY + topNode.mid;
  const bottomWire = Math.max(topY + topNode.h + 34, topWire + 90) + (bottomNode ? bottomNode.mid - 22 : 0);
  const left = margin;
  const right = margin + innerW;
  const out = [];
  const dots = [];
  // The loop.
  const tx = left + (innerW - topNode.w) / 2;
  draw(topNode, tx, topWire - topNode.mid, spec.style, out, dots);
  out.push(line([left, topWire], [tx, topWire], S), line([tx + topNode.w, topWire], [right, topWire], S));
  out.push(line([left, topWire], [left, bottomWire], S), line([right, topWire], [right, bottomWire], S));
  if (bottomNode) {
    const bx = left + (innerW - bottomNode.w) / 2;
    draw(bottomNode, bx, bottomWire - bottomNode.mid, spec.style, out, dots);
    out.push(line([left, bottomWire], [bx, bottomWire], S), line([bx + bottomNode.w, bottomWire], [right, bottomWire], S));
  } else {
    out.push(line([left, bottomWire], [right, bottomWire], S));
  }
  if (spec.current) {
    const mx = left + 18;
    const my = (topWire + bottomWire) / 2;
    out.push(poly([[mx - 6, my + 4], [mx, my - 8], [mx + 6, my + 4]], `fill="${INK}" stroke="none"`, true), text(mx + 12, my, "I", `font-size="13" font-style="italic" fill="${INK}"`));
  }
  for (const [x, y] of dots) out.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="3.4" fill="${INK}"/>`);
  const width = right + margin;
  const height = bottomWire + (bottomNode ? bottomNode.h - bottomNode.mid : 0) + margin;
  const drawn = sheet({ width: Math.max(width, 360), height, title: spec.title, body: `<g transform="translate(${r2(Math.max(0, (360 - width) / 2))} 0)">${out.join("")}</g>` });
  return { title: spec.title, ...drawn };
}
