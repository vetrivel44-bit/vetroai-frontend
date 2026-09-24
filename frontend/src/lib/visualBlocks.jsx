import React from "react";
import MermaidDiagram from "../components/chat/MermaidDiagram";
import ChartBlock from "../components/chat/visuals/ChartBlock";
import WidgetBlock from "../components/chat/visuals/WidgetBlock";
import MapBlock from "../components/chat/visuals/MapBlock";

// Which fenced code blocks are drawn as visuals instead of shown as code.
// Only these exact tags — ordinary code the user asked for (a Python script,
// a SQL query, a plain ```html or ```json snippet) always stays code:
//   ```mermaid        diagrams (flowchart, UML, ER, sequence…)
//   ```chartjs        Chart.js config JSON
//   ```html widget    a self-contained interactive widget / mockup
//   ```json map       [{ name, lat, lng, notes }]
export function renderVisualBlock({ lang, meta, code, fallback }) {
  const language = String(lang || "").toLowerCase();
  const tags = String(meta || "").toLowerCase().split(/\s+/);
  if (language === "mermaid") return <MermaidDiagram code={code} fallback={fallback} />;
  if (language === "chartjs") return <ChartBlock code={code} fallback={fallback} />;
  if (language === "html" && tags.includes("widget")) return <WidgetBlock code={code} fallback={fallback} />;
  if (language === "json" && tags.includes("map")) return <MapBlock code={code} fallback={fallback} />;
  return null;
}
