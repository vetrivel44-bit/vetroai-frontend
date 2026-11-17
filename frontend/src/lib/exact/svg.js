// Small helpers shared by the exact drawings (ray diagrams, circuits,
// geometry, graphs): SVG text built safely, and the look they share — black
// ink on white paper, like a fair copy in a notebook or a textbook.

export const INK = "#1f1e1d";
export const FONT = "Arial, Helvetica, sans-serif";
export const r2 = (v) => Math.round(v * 100) / 100;
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const clean = (s, max = 80) => String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export const num = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v.replace(/[a-zΩ°%]+$/i, "").trim());
  return NaN;
};

// A number for a label: whole when it is, else up to two places.
export const fmt = (v, places = 2) => {
  if (!Number.isFinite(v)) return "∞";
  const r = Math.round(v * 10 ** places) / 10 ** places;
  return (Object.is(r, -0) ? 0 : r).toString().replace("-", "−");
};

export const line = (a, b, attrs = "") => `<path d="M${r2(a[0])} ${r2(a[1])}L${r2(b[0])} ${r2(b[1])}"${attrs ? ` ${attrs}` : ""}/>`;
export const poly = (pts, attrs = "", closed = false) => `<path d="M${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L")}${closed ? "Z" : ""}"${attrs ? ` ${attrs}` : ""}/>`;
export const text = (x, y, s, attrs = "") => `<text x="${r2(x)}" y="${r2(y)}"${attrs ? ` ${attrs}` : ""}>${esc(s)}</text>`;

// A filled arrowhead with its tip at `tip`, pointing along `dir`.
export function arrowHead(tip, dir, size = 9, width = 3.2, fill = INK) {
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const u = [dir[0] / l, dir[1] / l];
  const n = [-u[1], u[0]];
  const base = [tip[0] - u[0] * size, tip[1] - u[1] * size];
  return poly([tip, [base[0] + n[0] * width, base[1] + n[1] * width], [base[0] - n[0] * width, base[1] - n[1] * width]], `fill="${fill}" stroke="none"`, true);
}

// The finished picture: white paper, a title, the drawing, a caption.
export function sheet({ width, height, title, body, caption }) {
  const capLines = caption ? wrap(caption, Math.floor(width / 7.4)) : [];
  const top = title ? 34 : 10;
  const total = top + height + (capLines.length ? capLines.length * 19 + 14 : 8);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(width)} ${r2(total)}" font-family="${FONT}" role="img"><title>${esc(title || "Diagram")}</title>`,
    `<rect width="${r2(width)}" height="${r2(total)}" fill="#fff"/>`,
    title ? text(width / 2, 23, title, `font-size="16" font-weight="700" text-anchor="middle" fill="${INK}"`) : "",
    `<g transform="translate(0 ${top})">${body}</g>`,
    ...capLines.map((l, i) => text(width / 2, top + height + 22 + i * 19, l, `font-size="13.5" text-anchor="middle" fill="#3d3a36"`)),
    "</svg>",
  ];
  return { svg: parts.join(""), width, height: total };
}

export function wrap(s, max) {
  const words = String(s).split(/\s+/);
  const out = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
