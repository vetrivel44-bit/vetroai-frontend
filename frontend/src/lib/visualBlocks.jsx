import React from "react";
import MermaidDiagram from "../components/chat/MermaidDiagram";
import ChartBlock from "../components/chat/visuals/ChartBlock";
import WidgetBlock from "../components/chat/visuals/WidgetBlock";
import MapBlock from "../components/chat/visuals/MapBlock";
import QuizBlock from "../components/chat/visuals/QuizBlock";
import ChoiceBlock from "../components/chat/visuals/ChoiceBlock";
import ThreeBlock from "../components/chat/visuals/ThreeBlock";
import SlidesBlock from "../components/chat/visuals/SlidesBlock";

// Which fenced code blocks are drawn as visuals instead of shown as code.
// Only these exact tags — ordinary code the user asked for (a Python script,
// a SQL query, a plain ```html or ```json snippet) always stays code:
//   ```mermaid        diagrams (flowchart, UML, ER, sequence…)
//   ```chartjs        Chart.js config JSON
//   ```html widget    a self-contained interactive widget / mockup
//   ```json map       [{ name, lat, lng, notes }]
//   ```quiz           multiple-choice test (see lib/quiz.js)
//   ```choices        clarifying question with tappable answers (lib/choices.js)
//   ```3d             interactive Three.js model (lib/threeStage.js)
//   ```slides         presentation, previewed and downloaded as .pptx (lib/slides.js)
export function renderVisualBlock({ lang, meta, code, fallback }) {
  const language = String(lang || "").toLowerCase();
  const tags = String(meta || "").toLowerCase().split(/\s+/);
  if (language === "mermaid") return <MermaidDiagram code={code} fallback={fallback} />;
  if (language === "chartjs") return <ChartBlock code={code} fallback={fallback} />;
  if (language === "html" && tags.includes("widget")) return <WidgetBlock code={code} fallback={fallback} />;
  if (language === "json" && tags.includes("map")) return <MapBlock code={code} fallback={fallback} />;
  if (language === "choices") return <ChoiceBlock code={code} fallback={fallback} />;
  if (language === "quiz") return <QuizBlock code={code} fallback={fallback} />;
  if (language === "3d" || language === "threejs") return <ThreeBlock code={code} fallback={fallback} />;
  if (language === "slides" || language === "pptx" || language === "presentation") return <SlidesBlock code={code} fallback={fallback} />;
  return null;
}
