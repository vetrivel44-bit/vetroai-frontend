import React, { Suspense, useContext, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { VisualPending } from "../components/chat/visuals/VisualCard";
import { OpenBlockContext, isStillStreaming } from "./visualStream";
import { detectVisual, mightBeVisual } from "./visualDetect";
import MermaidDiagram from "../components/chat/MermaidDiagram";
import ChartBlock from "../components/chat/visuals/ChartBlock";
import WidgetBlock from "../components/chat/visuals/WidgetBlock";
import MapBlock from "../components/chat/visuals/MapBlock";
import QuizBlock from "../components/chat/visuals/QuizBlock";
import ChoiceBlock from "../components/chat/visuals/ChoiceBlock";
import ThreeBlock from "../components/chat/visuals/ThreeBlock";
import SlidesBlock from "../components/chat/visuals/SlidesBlock";
import SketchBlock from "../components/chat/visuals/SketchBlock";

// Which fenced code blocks are drawn as visuals instead of shown as code.
// Only these exact tags — ordinary code the user asked for (a Python script,
// a SQL query, a plain ```html or ```json snippet) always stays code:
//   ```mermaid        diagrams (flowchart, UML, ER, sequence…)
//   ```mermaid sketch the same, drawn by hand (study notes, exam answers)
//   ```chartjs        Chart.js config JSON
//   ```html widget    a self-contained interactive widget / mockup
//   ```json map       [{ name, lat, lng, notes }]
//   ```quiz           multiple-choice test (see lib/quiz.js)
//   ```choices        clarifying question with tappable answers (lib/choices.js)
//   ```3d             interactive Three.js model (lib/threeStage.js)
//   ```slides         presentation, previewed and downloaded as .pptx (lib/slides.js)
//   ```sketch         a hand-drawn picture of the thing asked for (lib/sketchSvg.js)
export function renderVisualBlock({ lang, meta, code, fallback }) {
  const language = String(lang || "").toLowerCase();
  const tags = String(meta || "").toLowerCase().split(/\s+/);
  if (language === "mermaid") return <MermaidDiagram code={code} fallback={fallback} sketch={tags.some((t) => /^(sketch|hand-?drawn|handwritten)$/.test(t))} />;
  if (language === "chartjs") return <ChartBlock code={code} fallback={fallback} />;
  if (language === "html" && tags.includes("widget")) return <WidgetBlock code={code} fallback={fallback} />;
  if (language === "json" && tags.includes("map")) return <MapBlock code={code} fallback={fallback} />;
  if (language === "choices") return <ChoiceBlock code={code} fallback={fallback} />;
  if (language === "quiz") return <QuizBlock code={code} fallback={fallback} />;
  if (language === "3d" || language === "threejs") return <ThreeBlock code={code} fallback={fallback} />;
  if (language === "sketch" || (language === "svg" && tags.includes("sketch"))) return <SketchBlock code={code} fallback={fallback} />;
  if (language === "slides" || language === "pptx" || language === "presentation") return <SlidesBlock code={code} fallback={fallback} />;
  // Any other tag (```chart, ```graph, untagged…): drawn when its content is
  // a visual, so the user never sees a chart's or map's raw JSON.
  if (mightBeVisual(language, code)) return <AutoVisual lang={language} code={code} fallback={fallback} />;
  return null;
}

// Loaded on first use: it renders blocks that themselves use this module.
const StructuredResponseRenderer = React.lazy(() => import("../components/structured/StructuredResponseRenderer"));

function AutoVisual({ lang, code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const found = useMemo(() => (pending ? null : detectVisual(lang, code)), [lang, code, pending]);
  if (pending) return <VisualPending icon={Sparkles} label="Preparing visual…" />;
  if (!found) return fallback;
  const json = found.data ? JSON.stringify(found.data, null, 2) : "";
  switch (found.kind) {
    case "structured":
      return <Suspense fallback={null}><StructuredResponseRenderer response={"```json\n" + json + "\n```"} /></Suspense>;
    case "chartjs": return <ChartBlock code={json} fallback={fallback} />;
    case "map": return <MapBlock code={json} fallback={fallback} />;
    case "quiz": return <QuizBlock code={json} fallback={fallback} />;
    case "choices": return <ChoiceBlock code={json} fallback={fallback} />;
    case "mermaid": return <MermaidDiagram code={found.code} fallback={fallback} />;
    default: return fallback;
  }
}
