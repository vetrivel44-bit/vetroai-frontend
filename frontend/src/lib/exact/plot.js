import { parseLooseJson } from "../looseJson.js";
import { INK, arrowHead, clean, fmt, line, num, r2, sheet, text } from "./svg.js";

// ```plot — graphs of functions, drawn from their formulas: "y = x^2 - 4",
// "sin(x)", "2^x". The app reads each formula (no code is ever run), plots it
// point by point, and finds and labels where it crosses the axes, its
// turning points and where two graphs meet — the model never has to.

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, floor: Math.floor, ceil: Math.ceil,
  sec: (v) => 1 / Math.cos(v), cosec: (v) => 1 / Math.sin(v), csc: (v) => 1 / Math.sin(v), cot: (v) => 1 / Math.tan(v),
  cbrt: Math.cbrt, sign: Math.sign,
};
const CONSTS = { pi: Math.PI, π: Math.PI, e: Math.E };

// Formula text as models and people write it, in one plain form.
function normalise(src) {
  return String(src)
    .replace(/^\s*(?:y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\)|h\s*\(\s*x\s*\))\s*=/i, "")
    .replace(/[−–—]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^")
    .replace(/²/g, "^2").replace(/³/g, "^3").replace(/√\s*\(/g, "sqrt(").replace(/√\s*([a-z0-9.]+)/gi, "sqrt($1)")
    .replace(/\bMath\./g, "").trim();
}

const SUPER = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻" };
// A formula as it would be printed: x² rather than x^2, 2x rather than 2*x.
export function pretty(formula) {
  return normalise(formula)
    .replace(/\^\(?(-?\d+)\)?/g, (_, d) => [...d].map((c) => SUPER[c] || c).join(""))
    .replace(/(\d)\s*\*\s*(?=[a-zπ(])/gi, "$1")
    .replace(/\s*\*\s*/g, "·")
    .replace(/sqrt\(/g, "√(")
    .replace(/\bpi\b/g, "π")
    .replace(/-/g, " − ").replace(/\+/g, " + ").replace(/\s+/g, " ").replace(/^ − /, "−").replace(/\( − /g, "(−")
    .trim();
}

/**
 * A formula in x → a function of x, or throws with what was wrong. Numbers,
 * x, + − × ÷ ^, brackets, the usual functions and constants, and implicit
 * multiplication ("2x", "3(x+1)", "x sin x").
 */
export function compileFormula(source) {
  const s = normalise(source);
  const tokens = [];
  const re = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-zπ]+\d*|[-+*/^(),|])/giy;
  let m;
  let at = 0;
  while (at < s.length) {
    re.lastIndex = at;
    m = re.exec(s);
    if (!m) throw new Error(`can't read "${s.slice(at, at + 8)}"`);
    tokens.push(m[1]);
    at = re.lastIndex;
    if (/^\s*$/.test(s.slice(at))) break;
  }
  let i = 0;
  let absDepth = 0; // inside |…|, a "|" closes rather than opens
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const isAtomStart = (t) => t != null && (/^[\d.]/.test(t) || /^[a-zπ]/i.test(t) || t === "(" || (t === "|" && absDepth === 0));
  // expr := term (('+'|'-') term)*
  function expr() {
    let left = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const right = term();
      const l = left;
      left = op === "+" ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  }
  // term := unary (('*'|'/'|implicit) unary)*
  function term() {
    let left = unary();
    for (;;) {
      if (peek() === "*" || peek() === "/") {
        const op = next();
        const right = unary();
        const l = left;
        left = op === "*" ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
      } else if (isAtomStart(peek())) {
        const right = unary();
        const l = left;
        left = (x) => l(x) * right(x);
      } else return left;
    }
  }
  function unary() {
    if (peek() === "-") { next(); const v = unary(); return (x) => -v(x); }
    if (peek() === "+") { next(); return unary(); }
    return power();
  }
  // power := atom ('^' unary)?   (right-assoc: 2^3^2 = 2^9)
  function power() {
    const base = atom();
    if (peek() === "^") {
      next();
      const ex = unary();
      return (x) => base(x) ** ex(x);
    }
    return base;
  }
  function atom() {
    const t = next();
    if (t == null) throw new Error("the formula ends too soon");
    if (/^[\d.]/.test(t)) { const v = Number(t); return () => v; }
    if (t === "(") { const v = expr(); if (next() !== ")") throw new Error("a bracket isn't closed"); return v; }
    if (t === "|") {
      absDepth++;
      const v = expr();
      absDepth--;
      if (next() !== "|") throw new Error("an |absolute value| isn't closed");
      return (x) => Math.abs(v(x));
    }
    const name = t.toLowerCase();
    if (name === "x") return (x) => x;
    if (Object.hasOwn(CONSTS, name)) { const v = CONSTS[name]; return () => v; }
    // sin x, sin(x), sin^2 x, log2(x)
    if (Object.hasOwn(FUNCS, name)) {
      const fn = FUNCS[name];
      let powerOf = null;
      if (peek() === "^") { next(); const p = atom(); powerOf = p; }
      const arg = peek() === "(" ? atom() : power();
      return powerOf ? (x) => fn(arg(x)) ** powerOf(x) : (x) => fn(arg(x));
    }
    // "xsinx", "2pi", "xx": split a run of letters into known names.
    const parts = name.match(/sinh|cosh|tanh|asin|acos|atan|sin|cos|tan|sec|cosec|csc|cot|sqrt|abs|exp|ln|log|pi|e|x/g);
    if (parts && parts.join("") === name) {
      tokens.splice(i - 1, 1, ...parts);
      i -= 1;
      return atom();
    }
    throw new Error(`"${t}" isn't something a graph can use`);
  }
  const f = expr();
  if (i < tokens.length) throw new Error(`can't read "${tokens.slice(i).join("")}"`);
  return (x) => { const v = f(x); return Number.isFinite(v) ? v : NaN; };
}

const COLOURS = ["#1d4ed8", "#b91c1c", "#15803d", "#7e22ce", "#c2410c"];

// Round to a "nice" step: 1, 2 or 5 × 10^n.
function niceStep(span, target = 8) {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function bisect(f, a, b) {
  let fa = f(a);
  for (let k = 0; k < 60; k++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (!Number.isFinite(fm)) return null;
    if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

export function parsePlot(input) {
  let raw = null;
  const src = String(input || "").trim();
  try { raw = parseLooseJson(src); } catch { raw = null; }
  // A bare formula is fine too.
  if (!raw || typeof raw !== "object") raw = { functions: src.split(/\n|;/).map((l) => l.trim()).filter(Boolean) };
  const fnList = Array.isArray(raw) ? raw : Array.isArray(raw.functions) ? raw.functions : raw.function || raw.y ? [raw.function ?? raw] : [];
  const fns = [];
  for (const item of fnList.slice(0, 5)) {
    const formula = typeof item === "string" ? item : item?.y ?? item?.f ?? item?.formula ?? item?.expr ?? item?.function;
    if (!formula) continue;
    try {
      fns.push({ f: compileFormula(formula), label: clean((typeof item === "object" && item.label) || `y = ${pretty(formula)}`, 40), formula: String(formula) });
    } catch (err) {
      return { error: `Couldn't read the formula "${clean(formula, 40)}": ${err.message}.` };
    }
  }
  if (!fns.length) return { error: "The graph has no formula to draw." };
  const range = (v, fallback) => (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(num(n))) && num(v[1]) > num(v[0]) ? v.map(num) : fallback);
  return {
    spec: {
      fns,
      x: range(raw.x ?? raw.xRange ?? raw.domain, [-10, 10]),
      y: range(raw.y ?? raw.yRange, null),
      title: clean(raw.title ?? fns.map((f) => f.label).join(",  "), 80),
      points: (Array.isArray(raw.points) ? raw.points : []).slice(0, 12).map((p) => ({ x: num(p?.x ?? p?.[0]), y: num(p?.y ?? p?.[1]), label: clean(p?.label ?? "", 30) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      features: raw.features !== false && raw.mark !== false,
      xLabel: clean(raw.xLabel ?? "x", 12),
      yLabel: clean(raw.yLabel ?? "y", 12),
    },
  };
}

/** A ```plot block → `{ title, svg, width, height, features }` or `{ error }`. */
export function renderPlot(code) {
  const { spec, error } = parsePlot(code);
  if (error) return { error };
  const [xa, xb] = spec.x;
  const N = 800;
  const samples = spec.fns.map(({ f }) => Array.from({ length: N + 1 }, (_, i) => { const x = xa + ((xb - xa) * i) / N; return [x, f(x)]; }));
  // The y range: what the graphs do, without letting an asymptote flatten
  // everything else.
  let ya;
  let yb;
  if (spec.y) [ya, yb] = spec.y;
  else {
    const ys = samples.flat().map((p) => p[1]).filter(Number.isFinite).sort((p, q) => p - q);
    if (!ys.length) return { error: "The graph has no values to draw in that range." };
    ya = Math.min(0, ys[Math.floor(ys.length * 0.03)]);
    yb = Math.max(0, ys[Math.floor(ys.length * 0.97)]);
    if (yb - ya < 1e-9) { ya -= 1; yb += 1; }
    const extra = (yb - ya) * 0.12;
    ya -= extra; yb += extra;
  }
  const W = 640;
  const H = 420;
  const pad = 30;
  const X = (x) => pad + ((x - xa) / (xb - xa)) * (W - 2 * pad);
  const Y = (y) => H - pad - ((y - ya) / (yb - ya)) * (H - 2 * pad);
  const out = [];

  // Grid and axes.
  const xs = niceStep(xb - xa);
  const ysStep = niceStep(yb - ya);
  for (let v = Math.ceil(xa / xs) * xs; v <= xb + 1e-9; v += xs) out.push(line([X(v), Y(ya)], [X(v), Y(yb)], `stroke="#e7e5e4" stroke-width="1"`));
  for (let v = Math.ceil(ya / ysStep) * ysStep; v <= yb + 1e-9; v += ysStep) out.push(line([X(xa), Y(v)], [X(xb), Y(v)], `stroke="#e7e5e4" stroke-width="1"`));
  const axisY = Math.min(Math.max(0, ya), yb);
  const axisX = Math.min(Math.max(0, xa), xb);
  out.push(line([X(xa), Y(axisY)], [X(xb), Y(axisY)], `stroke="${INK}" stroke-width="1.4"`), arrowHead([X(xb) + 6, Y(axisY)], [1, 0], 9, 3.5));
  out.push(line([X(axisX), Y(ya)], [X(axisX), Y(yb)], `stroke="${INK}" stroke-width="1.4"`), arrowHead([X(axisX), Y(yb) - 6], [0, -1], 9, 3.5));
  out.push(text(X(xb) + 4, Y(axisY) + 18, spec.xLabel, `font-size="14" font-style="italic" fill="${INK}"`));
  out.push(text(X(axisX) + 10, Y(yb) - 2, spec.yLabel, `font-size="14" font-style="italic" fill="${INK}"`));
  for (let v = Math.ceil(xa / xs) * xs; v <= xb + 1e-9; v += xs) {
    if (Math.abs(v) < xs / 1e6) continue;
    out.push(line([X(v), Y(axisY) - 3], [X(v), Y(axisY) + 3], `stroke="${INK}"`), text(X(v), Y(axisY) + 15, fmt(v, 3), `font-size="11" text-anchor="middle" fill="#57534e"`));
  }
  for (let v = Math.ceil(ya / ysStep) * ysStep; v <= yb + 1e-9; v += ysStep) {
    if (Math.abs(v) < ysStep / 1e6) continue;
    out.push(line([X(axisX) - 3, Y(v)], [X(axisX) + 3, Y(v)], `stroke="${INK}"`), text(X(axisX) - 6, Y(v) + 4, fmt(v, 3), `font-size="11" text-anchor="end" fill="#57534e"`));
  }
  if (xa < 0 && xb > 0 && ya < 0 && yb > 0) out.push(text(X(0) - 8, Y(0) + 15, "O", `font-size="12" font-style="italic" text-anchor="end" fill="${INK}"`));

  // The curves, broken where they jump (an asymptote) or leave the picture.
  const clipId = `plot-${(spec.title + spec.fns.map((f) => f.formula).join("|")).split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}`;
  out.push(`<clipPath id="${clipId}"><rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}"/></clipPath>`);
  const span = yb - ya;
  samples.forEach((pts, n) => {
    let d = "";
    let pen = false;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const prev = pts[i - 1];
      const jump = prev && Number.isFinite(prev[1]) && Number.isFinite(y) && Math.abs(y - prev[1]) > span * 2;
      if (!Number.isFinite(y) || jump) { pen = false; if (!Number.isFinite(y)) continue; }
      const yy = Math.max(ya - span, Math.min(yb + span, y));
      d += `${pen ? "L" : "M"}${r2(X(x))} ${r2(Y(yy))}`;
      pen = true;
    }
    out.push(`<path d="${d}" fill="none" stroke="${COLOURS[n % COLOURS.length]}" stroke-width="2.4" stroke-linejoin="round" clip-path="url(#${clipId})"/>`);
  });

  // What the graphs do: crossings, turning points, meetings.
  const features = [];
  const seen = [];
  const labelBoxes = [];
  const mark = (x, y, label, colour = INK) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < xa || x > xb || y < ya || y > yb) return;
    if (seen.some(([sx, sy]) => Math.abs(X(sx) - X(x)) < 4 && Math.abs(Y(sy) - Y(y)) < 4)) return;
    seen.push([x, y]);
    features.push({ x, y, label });
    out.push(`<circle cx="${r2(X(x))}" cy="${r2(Y(y))}" r="4" fill="${colour}" stroke="#fff" stroke-width="1.5"/>`);
    // The first of four spots round the point that is clear of the others.
    const w = label.length * 6.4;
    const spots = [[8, -8, "start"], [-8, -8, "end"], [8, 16, "start"], [-8, 16, "end"], [8, -22, "start"], [-8, 30, "end"]];
    let pick = null;
    for (const [dx, dy, anchor] of spots) {
      const bx = anchor === "start" ? X(x) + dx : X(x) + dx - w;
      const box = [bx - 2, Y(y) + dy - 11, bx + w + 2, Y(y) + dy + 3];
      if (box[0] < 2 || box[2] > W - 2) continue;
      if (!labelBoxes.some((o) => box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3])) { pick = { dx, dy, anchor, box }; break; }
    }
    if (!pick) return;
    labelBoxes.push(pick.box);
    out.push(text(X(x) + pick.dx, Y(y) + pick.dy, label, `font-size="11.5" text-anchor="${pick.anchor}" fill="${INK}" paint-order="stroke" stroke="#fff" stroke-width="3.5"`));
  };
  const at = (x, y) => `(${fmt(x)}, ${fmt(y)})`;
  if (spec.features) {
    spec.fns.forEach(({ f }, n) => {
      const pts = samples[n];
      const colour = COLOURS[n % COLOURS.length];
      for (let i = 1; i < pts.length; i++) {
        const [xp, yp] = pts[i - 1];
        const [x, y] = pts[i];
        if (!Number.isFinite(yp) || !Number.isFinite(y)) continue;
        if (y === 0) mark(x, 0, at(x, 0), colour);
        else if ((yp < 0) !== (y < 0) && Math.abs(y - yp) < span) {
          const r = bisect(f, xp, x);
          if (r != null && Math.abs(f(r)) < span * 1e-3) mark(r, 0, at(r, 0), colour);
        }
        // Turning points: the slope changes sign.
        if (i >= 2) {
          const [, y0] = pts[i - 2];
          if (Number.isFinite(y0) && (yp - y0) * (y - yp) < 0 && Math.abs(y - y0) < span) {
            const g = (t) => (f(t + 1e-6) - f(t - 1e-6));
            const r = bisect(g, pts[i - 2][0], x);
            if (r != null) mark(r, f(r), at(r, f(r)), colour);
          }
        }
      }
      if (xa <= 0 && xb >= 0) { const y0 = f(0); if (Number.isFinite(y0)) mark(0, y0, at(0, y0), colour); }
    });
    for (let a = 0; a < spec.fns.length; a++) {
      for (let b = a + 1; b < spec.fns.length; b++) {
        const h = (x) => spec.fns[a].f(x) - spec.fns[b].f(x);
        for (let i = 1; i <= N; i++) {
          const xp = xa + ((xb - xa) * (i - 1)) / N;
          const x = xa + ((xb - xa) * i) / N;
          const hp = h(xp);
          const hx = h(x);
          if (Number.isFinite(hp) && Number.isFinite(hx) && (hp < 0) !== (hx < 0) && Math.abs(hx - hp) < span) {
            const r = bisect(h, xp, x);
            if (r != null && Math.abs(h(r)) < span * 1e-3) mark(r, spec.fns[a].f(r), at(r, spec.fns[a].f(r)));
          }
        }
      }
    }
  }
  for (const p of spec.points) mark(p.x, p.y, p.label || at(p.x, p.y));

  // A key, when there is more than one graph.
  if (spec.fns.length > 1) {
    spec.fns.forEach(({ label }, n) => {
      const y = pad + 8 + n * 18;
      out.push(line([W - pad - 150, y], [W - pad - 128, y], `stroke="${COLOURS[n % COLOURS.length]}" stroke-width="3"`));
      out.push(text(W - pad - 122, y + 4, label, `font-size="12" fill="${INK}"`));
    });
  }
  const drawn = sheet({ width: W, height: H, title: spec.title, body: out.join("") });
  return { title: spec.title, ...drawn, features };
}
