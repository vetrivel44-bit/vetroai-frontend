// Drawings the app works out exactly (lib/exact/), so they are never wrong
// the way a freehand sketch was: ray diagrams, circuit diagrams, geometry
// figures, graphs of functions and chemical structures. Each kind is spotted
// in the question and comes with its own rules; the model only describes
// what the question gives.

const DRAW = /\b(draw|drawn|sketch|diagram|illustrat\w*|show|construct|plot|graph|figure|picture|labell?ed)\b/i;

const KINDS = [
  {
    kind: "optics",
    tag: "optics",
    what: "ray diagram",
    test: (t) => /\bray diagrams?\b/i.test(t)
      || (/\b(lens|lenses|mirror|mirrors)\b/i.test(t) && (DRAW.test(t) || /\bimage (?:formation|formed|is formed)\b|\bformation of (?:the )?image\b/i.test(t))),
  },
  {
    kind: "circuit",
    tag: "circuit",
    what: "circuit diagram",
    test: (t) => /\bcircuit diagrams?\b|\bschematic diagram\b/i.test(t)
      || (DRAW.test(t) && /\b(circuit|resistors?|bulbs?|ammeter|voltmeter|galvanometer|rheostat|in series|in parallel|plug key)\b/i.test(t) && !/\b(integrated circuit|logic gate|flip-?flop|circuit board)\b/i.test(t)),
  },
  {
    kind: "plot",
    tag: "plot",
    what: "graph",
    test: (t) => /\b(plot|graph|curve|sketch|draw)\b/i.test(t)
      && /(\by\s*=|\bf\s*\(\s*x\s*\)|\bx\s*\^|x²|x³|\b(?:sin|cos|tan|log|ln|sqrt|exp)\s*\(?\s*x\b|\bparabola\b|\bhyperbola\b|\bquadratic (?:function|equation|polynomial)\b|\bpolynomial\b|\bexponential function\b)/i.test(t)
      && !/\b(bar|pie|histogram|data|table|sales|population|marks)\b/i.test(t),
  },
  {
    kind: "geometry",
    tag: "geometry",
    what: "figure",
    test: (t) => (DRAW.test(t) || /\bprove\b|\btheorem\b/i.test(t))
      && /\b(triangles?|circles?|tangents?|chords?|quadrilaterals?|rhombus|parallelogram|trapezium|trapezoid|rectangle|square|polygon|perpendicular bisector|angle bisector|bisect|median|altitude|circumcircle|incircle|concentric|secant|arc|sector|segment of a circle|cyclic|congruent|similar triangles)\b/i.test(t)
      && !/\b(cell|heart|flower|eye|brain|leaf|map|volcano|atom|circuit|lens|mirror)\b/i.test(t),
  },
  {
    kind: "molecule",
    tag: "molecule",
    what: "structure",
    test: (t) => (/\b(structural formula|skeletal formula|bond-?line|lewis structure of (?:an? )?(?:organic|molecule))\b/i.test(t)
      || (/\b(structure|structures|draw|isomers?)\b/i.test(t) && /\b(\w+(?:ane|ene|yne|anol|enol|anal|anone|oic acid|ate)|benzene|toluene|phenol|aniline|glucose|fructose|sucrose|ethanol|methanol|acetone|aspirin|caffeine|urea|ester|ether|amine|isomers?|compound|molecule|hydrocarbon)\b/i.test(t)))
      && !/\b(atom|atomic|cell|dna|rna|protein|earth|heart|flower|eye|brain|leaf|crystal|lattice|solid|bohr)\b/i.test(t),
  },
];

/** Which exact drawing a question needs, or null. */
export function exactKind(text) {
  const t = String(text || "");
  return KINDS.find((k) => k.test(t))?.kind || null;
}

export const EXACT_RULES = {
  optics: `Ray diagram rules (\`\`\`optics) — image formation by a lens or mirror. Never draw the rays freehand: give the set-up in one \`\`\`optics block of JSON, and the app works out the image with the lens or mirror formula and draws the standard rays exactly.
- {"device": "convex lens" | "concave lens" | "concave mirror" | "convex mirror" | "plane mirror", "f": focal length, "u": object distance (a positive number), "h": object height, "units": "cm", "title": "…"}
- When the question names a position instead of a distance, give "position": "beyond 2F", "at 2F", "between F and 2F", "at F", "between F and O" (lens) or "beyond C", "at C", "between C and F", "at F", "between F and P" (mirror), or "at infinity", and leave "u" out.
- Several cases (every position of the object): one \`\`\`optics block for each.
Example:
\`\`\`optics
{"device": "convex lens", "f": 10, "position": "between F and 2F", "title": "Object between F₁ and 2F₁"}
\`\`\``,
  circuit: `Circuit diagram rules (\`\`\`circuit) — say how the parts are joined in one \`\`\`circuit block of JSON; the app draws the standard symbols, the wires and the junctions.
- {"title": "…", "circuit": [ … ]}: the list is the loop, in series, in order round the circuit. A part is a name — "cell", "battery", "resistor", "rheostat", "bulb", "switch", "key", "ammeter", "voltmeter", "galvanometer", "diode", "led", "capacitor", "fuse", "motor", "bell", "ac" — or an object to label it: {"resistor": "R1 = 4 Ω"}, {"battery": "6 V", "cells": 3}, {"switch": "S", "state": "open"}.
- Parts side by side: ["parallel", part, part, …]; a branch holding several parts: ["series", part, part]. A voltmeter goes in parallel with what it measures: ["parallel", {"resistor": "R"}, "voltmeter"].
Example (verifying Ohm's law):
\`\`\`circuit
{"title": "Circuit to verify Ohm's law", "circuit": [{"battery": "6 V"}, {"key": "K"}, "ammeter", ["parallel", {"resistor": "R"}, "voltmeter"], "rheostat"]}
\`\`\``,
  geometry: `Geometry figure rules (\`\`\`geometry) — triangles, circles, tangents, constructions and theorem figures. Never place points by eye: give the facts in one \`\`\`geometry block of JSON, and the app works out every point, so lengths and angles are true.
- "triangle": {"name": "ABC", "AB": 6, "BC": 5, "CA": 4} — or two sides and the angle between them ({"AB": 6, "angleA": 60, "AC": 5}), or one side and two angles ({"BC": 7, "angleB": 45, "angleC": 60}). A goes at the origin, AB along the base.
- "points": {"O": [0, 0]} (coordinates), {"mid": ["B", "C"]}, {"on": ["A", "B"], "dist": 3} or {"on": ["A", "B"], "ratio": [2, 3]}, {"foot": "A", "on": ["B", "C"]} (perpendicular from A), {"from": "B", "toward": "C", "turn": 60, "dist": 5} (60° anticlockwise from BC at B), {"intersect": [["A", "D"], ["B", "E"]]}, {"centroid" | "circumcenter" | "incenter" | "orthocenter": ["A", "B", "C"]}, {"tangentFrom": "P", "circle": {"center": "O", "r": 3}, "which": 1 | 2}, {"onCircle": {"center": "O", "r": 3}, "angle": 40}, {"reflect": "P", "over": ["A", "B"]}.
- "segments": ["AB", {"from": "A", "to": "D", "dashed": true, "label": "5 cm" | true, "ticks": 1}], "lines" (right across), "rays", "polygons": [["A", "B", "C", "D"]], "circles": [{"center": "O", "r": 3} | {"center": "O", "through": "A"} | {"through": ["A", "B", "C"]}], "angles": ["ABC"] (vertex in the middle; its size is shown, a right angle as a square), "arcs": [{"center": "A", "r": 4, "around": "C"}] (compass marks of a construction), "unit": "cm".
Example:
\`\`\`geometry
{"title": "Tangents from an external point", "points": {"O": [0, 0], "P": [7, 0], "T": {"tangentFrom": "P", "circle": {"center": "O", "r": 3}}, "S": {"tangentFrom": "P", "circle": {"center": "O", "r": 3}, "which": 2}}, "circles": [{"center": "O", "r": 3}], "segments": ["PT", "PS", "OT", "OS", {"from": "O", "to": "P", "dashed": true}], "angles": ["OTP", "OSP"]}
\`\`\``,
  plot: `Graph rules (\`\`\`plot) — graphs of functions and equations. Never draw a curve by eye or as a chart of a few points: give the formulas in one \`\`\`plot block of JSON, and the app plots them exactly and marks where they cross the axes, their turning points and where they meet.
- {"title": "…", "functions": [{"y": "x^2 - 4"}, {"y": "2x + 1"}], "x": [-5, 5]} — formulas in x with + − * / ^, brackets, sin cos tan sqrt abs ln log exp, pi and e; "y": [min, max] to fix the height; "points": [{"x": 2, "y": 0, "label": "A"}] for extra points.
- For x² + y² = 9, give the two halves: "sqrt(9 - x^2)" and "-sqrt(9 - x^2)".
Example:
\`\`\`plot
{"title": "y = x² − 4", "functions": [{"y": "x^2 - 4"}], "x": [-4, 4]}
\`\`\``,
  molecule: `Structure rules (\`\`\`molecule) — structural formulas of molecules. Never draw the bonds by hand: give each molecule's SMILES in one \`\`\`molecule block of JSON and the app lays out the structure.
- {"title": "…", "molecules": [{"name": "Ethanol", "smiles": "CCO"}, {"name": "Ethanoic acid", "smiles": "CC(=O)O"}]}; for a reaction, put {"arrow": true} between the reactants and the products. Check each SMILES is right (benzene c1ccccc1, ethene C=C, acetic acid CC(=O)O).
Example:
\`\`\`molecule
{"title": "Isomers of butane", "molecules": [{"name": "n-Butane", "smiles": "CCCC"}, {"name": "Isobutane", "smiles": "CC(C)C"}]}
\`\`\``,
};

export function exactInstruction(kind) {
  const k = KINDS.find((x) => x.kind === kind);
  if (!k) return "";
  return [
    `[${k.what.toUpperCase()} — FOLLOW EXACTLY]`,
    `The user's question needs a ${k.what}. VetroAI draws it exactly from a description, so it can't come out wrong the way a hand-drawn one does.`,
    `Reply with one short line, then the \`\`\`${k.tag} block (the rules are below), then the explanation the question asks for.`,
    `Do NOT draw it in a \`\`\`sketch, as an image, as ASCII art or as a \`\`\`mermaid diagram.`,
    EXACT_RULES[kind],
  ].join("\n");
}
