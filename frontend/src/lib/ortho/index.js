import { parseOrthoSpec } from "./spec.js";
import { drawSheet } from "./sheet.js";

/**
 * An ```ortho block → the engineering drawing: `{ title, svg, iso, width,
 * height, sheet, scale, projection, notes }`, or `{ error }`.
 */
export function renderOrtho(code) {
  const { spec, error } = parseOrthoSpec(code);
  if (error) return { error };
  try {
    const sheet = drawSheet(spec);
    return { title: spec.title, projection: spec.projection, ...sheet };
  } catch (err) {
    return { error: `The drawing couldn't be worked out (${err?.message || err}).` };
  }
}

export { parseOrthoSpec };
