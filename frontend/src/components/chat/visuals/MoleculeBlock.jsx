import React, { useContext, useEffect, useState } from "react";
import { Atom } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import { DrawingBody } from "./ExactBlock";
import { saveBlob } from "../../../lib/exact/download.js";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { parseMolecules } from "../../../lib/exact/molecule.js";
import { FONT, INK, esc, r2 } from "../../../lib/exact/svg.js";

// ```molecule: chemical structures laid out from SMILES by smiles-drawer
// (loaded the first time one is shown), side by side with their names, and
// arrows between them for a reaction.

const CACHE = new Map();
const NS = "http://www.w3.org/2000/svg";

async function drawMolecules(spec) {
  const { default: SmilesDrawer } = await import("smiles-drawer");
  const drawer = new SmilesDrawer.SvgDrawer({ width: 260, height: 220, bondThickness: 1.4, fontSizeLarge: 7, fontSizeSmall: 5, padding: 12 });
  const cells = [];
  for (const item of spec.list) {
    if (item.arrow) { cells.push({ arrow: true, w: 70 }); continue; }
    const tree = await new Promise((resolve, reject) => SmilesDrawer.parse(item.smiles.trim(), resolve, reject));
    const host = document.createElementNS(NS, "svg");
    // Drawn off-screen: smiles-drawer measures text as it lays out.
    host.setAttribute("style", "position:absolute;left:-9999px;top:0;width:260px;height:220px");
    document.body.appendChild(host);
    try {
      drawer.draw(tree, host, "light");
      const inner = host.innerHTML;
      const vb = (host.getAttribute("viewBox") || "0 0 260 220").split(/[\s,]+/).map(Number);
      cells.push({ inner, vb, name: item.name, w: 260 });
    } finally {
      host.remove();
    }
  }
  const gap = 16;
  const width = cells.reduce((s, c) => s + c.w, 0) + gap * (cells.length + 1);
  const named = spec.list.some((m) => m.name);
  const top = spec.title ? 34 : 8;
  const height = top + 220 + (named ? 30 : 8);
  let x = gap;
  const parts = [];
  for (const c of cells) {
    if (c.arrow) {
      const y = top + 110;
      parts.push(`<path d="M${x + 8} ${y}H${x + c.w - 10}" stroke="${INK}" stroke-width="2"/><path d="M${x + c.w - 8} ${y}l-10 -5v10z" fill="${INK}"/>`);
    } else {
      parts.push(`<svg x="${r2(x)}" y="${top}" width="${c.w}" height="220" viewBox="${c.vb.join(" ")}" preserveAspectRatio="xMidYMid meet">${c.inner}</svg>`);
      if (c.name) parts.push(`<text x="${r2(x + c.w / 2)}" y="${top + 240}" font-size="14" font-weight="600" text-anchor="middle" fill="${INK}">${esc(c.name)}</text>`);
    }
    x += c.w + gap;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(width)} ${height}" font-family="${FONT}" role="img"><title>${esc(spec.title || spec.list.map((m) => m.name).filter(Boolean).join(", ") || "Structure")}</title><rect width="${r2(width)}" height="${height}" fill="#fff"/>${spec.title ? `<text x="${r2(width / 2)}" y="23" font-size="16" font-weight="700" text-anchor="middle" fill="${INK}">${esc(spec.title)}</text>` : ""}${parts.join("")}</svg>`;
  return { svg, width, height, title: spec.title || spec.list.map((m) => m.name).filter(Boolean).join(" → ") || "Structure", note: "Laid out from SMILES" };
}

export default function MoleculeBlock({ code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const [done, setDone] = useState(null);
  useEffect(() => {
    if (pending || CACHE.has(code)) return undefined;
    let live = true;
    const { spec, error } = parseMolecules(code);
    const job = error ? Promise.resolve({ error }) : drawMolecules(spec).catch((err) => ({ error: `The SMILES couldn't be read (${err?.message || err}).` }));
    job.then((result) => {
      CACHE.set(code, result);
      if (live) setDone({ code, result });
    });
    return () => { live = false; };
  }, [code, pending]);
  const result = pending ? null : CACHE.get(code) || (done?.code === code ? done.result : null);
  if (!result) return <VisualPending icon={Atom} label="Drawing the structure…" sketch="diagram" />;
  if (result.error) return <VisualFallback what="structure" error={result.error} fallback={fallback} />;
  return (
    <VisualCard icon={Atom} title={`${result.title} · structure`} code={code} onDownload={() => saveBlob(new Blob([result.svg], { type: "image/svg+xml" }), "structure.svg")} downloadLabel="Download SVG" bodyClassName="vor-body">
      <DrawingBody result={result} kind="structure" />
    </VisualCard>
  );
}
