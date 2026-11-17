import { parseLooseJson } from "../looseJson.js";
import { clean } from "./svg.js";

// ```molecule — chemical structures from SMILES ("CCO" is ethanol,
// "c1ccccc1" benzene): the structure is laid out by smiles-drawer, so bonds,
// rings and angles are right, where a freehand drawing guessed them. Several
// molecules can be shown in a row, with arrows for a reaction.

export function parseMolecules(input) {
  const src = String(input || "").trim();
  let raw = null;
  try { raw = parseLooseJson(src); } catch { raw = null; }
  let list;
  let arrows = false;
  let title = "";
  if (raw && typeof raw === "object") {
    const items = Array.isArray(raw) ? raw : Array.isArray(raw.molecules) ? raw.molecules : Array.isArray(raw.reactants) || Array.isArray(raw.products)
      ? [...(raw.reactants || []), { arrow: true }, ...(raw.products || [])] : [raw];
    arrows = Boolean(raw.reaction || raw.arrows) || items.some((m) => m?.arrow);
    title = clean(raw.title ?? "", 70);
    list = items.map((m) => (m?.arrow ? { arrow: true } : { smiles: typeof m === "string" ? m : m?.smiles ?? m?.SMILES, name: clean(m?.name ?? m?.label ?? "", 50), condition: clean(m?.over ?? "", 30) }));
  } else {
    // Plain SMILES, one per line (a "name: SMILES" line is fine too).
    list = src.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)\s*[:=]\s*(\S+)$/);
      return m ? { name: clean(m[1], 50), smiles: m[2] } : { smiles: l, name: "" };
    });
  }
  list = list.filter((m) => m.arrow || (typeof m.smiles === "string" && /^[A-Za-z0-9@+\-[\]()=#$/\\%.:*]+$/.test(m.smiles.trim()))).slice(0, 8);
  if (!list.some((m) => !m.arrow)) return { error: "The structure's SMILES isn't readable." };
  return { spec: { title, arrows, list } };
}
