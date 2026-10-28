import { VISUALS_PROMPT } from "./visualsPrompt.js";

// "Draw the brain", "hand-drawn diagram of the heart", "labelled diagram of a
// flower": a picture of the thing itself (a ```sketch), never a flowchart.
// The general instructions already say so, but a model can still reach for a
// flowchart, so a request like this carries its own instruction — with the
// sketch rules, so it works even where the server's instructions are older.

const DRAWING = /\b(draw|drawing|drawn|sketch|sketched|diagram|illustrat\w*|picture of|labell?ed (?:diagram|picture|drawing))\b/i;
// A process, structure or data: these stay flowcharts, UML or charts.
const NOT_A_PICTURE = /\b(flow\s?-?charts?|flow diagram|process(?:es)?|steps?|stages?|mind\s?-?maps?|sequence diagram|uml|use[- ]case|class diagram|er diagram|erd|entity|architecture|timeline|gantt|org(?:anisation|anization)? chart|hierarchy|data|bar chart|pie chart|line chart|chart of)\b/i;

export const isDrawingRequest = (text) => {
  const t = String(text || "");
  return DRAWING.test(t) && !NOT_A_PICTURE.test(t);
};

const SKETCH_RULES = (() => {
  const start = VISUALS_PROMPT.indexOf("Sketch rules (```sketch)");
  const end = VISUALS_PROMPT.indexOf("Chart rules (```chartjs)");
  return start >= 0 && end > start ? VISUALS_PROMPT.slice(start, end).trim() : "";
})();

export function drawingInstruction(text) {
  return [
    "[DRAWING REQUEST — FOLLOW EXACTLY]",
    `The user asked: "${String(text || "").slice(0, 300)}". They want a picture of the thing itself, drawn like a labelled textbook diagram: its real shape, its parts in their real places, each part labelled.`,
    "Reply with one short line, then exactly one ```sketch block (the rules are below), then a few short points about the parts.",
    "Do NOT answer with a flowchart, a ```mermaid or ```mermaid sketch block, a mind map, boxes joined by arrows, or a list of parts instead of the drawing. A brain is drawn as a brain (its outline, the lobes, the cerebellum and the brainstem), a heart as a heart, a flower as a flower.",
    SKETCH_RULES,
    // Smaller models copied the rules' example (a house) instead of the subject.
    `The house above only shows the format. Draw what the user asked for — "${String(text || "").slice(0, 120)}" — and nothing else; never draw a house unless a house was asked for. Write the whole <svg> through to </svg> before the notes.`,
  ].filter(Boolean).join("\n");
}
