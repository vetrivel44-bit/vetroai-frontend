import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { useDocumentTheme } from "./useDocumentTheme";
import { styleConfig } from "../../../lib/chartStyle";

// A ```chartjs block: Chart.js config as JSON (bar, line, scatter, pie…).
// Chart.js loads the first time a chart appears.

function parseConfig(code) {
  const config = JSON.parse(code);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("expected a JSON object");
  if (typeof config.type !== "string") throw new Error("missing \"type\"");
  if (!config.data || !Array.isArray(config.data.datasets)) throw new Error("missing \"data.datasets\"");
  // A chart with no numbers drew an empty frame; show the fallback instead.
  const isNum = (v) => Number.isFinite(typeof v === "object" && v ? v.y ?? v.r : v);
  if (!config.data.datasets.some((ds) => Array.isArray(ds?.data) && ds.data.some(isNum))) throw new Error("the chart has no data");
  return config;
}

let chartModule = null;
const loadChart = () => (chartModule ||= import("chart.js/auto").then((m) => m.default));

export default function ChartBlock({ code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const theme = useDocumentTheme();
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [error, setError] = useState("");

  const parsed = useMemo(() => {
    if (pending) return null;
    try { return { config: parseConfig(code) }; } catch (err) { return { error: String(err.message || err).split("\n")[0] }; }
  }, [code, pending]);

  useEffect(() => {
    if (!parsed?.config || !canvasRef.current) return undefined;
    let alive = true;
    loadChart()
      .then((Chart) => {
        if (!alive || !canvasRef.current) return;
        chartRef.current?.destroy();
        chartRef.current = new Chart(canvasRef.current, styleConfig(parsed.config, theme));
      })
      .catch((err) => { if (alive) setError(String(err?.message || err).split("\n")[0]); });
    return () => { alive = false; chartRef.current?.destroy(); chartRef.current = null; };
  }, [parsed, theme]);

  if (pending) return <VisualPending icon={BarChart3} label="Drawing chart…" sketch="chart" />;
  if (parsed?.error || error) return <VisualFallback what="chart" error={parsed?.error || error} fallback={fallback} />;

  const title = parsed?.config?.options?.plugins?.title?.text || `${parsed?.config?.type?.replace(/^\w/, (c) => c.toUpperCase()) || ""} chart`;
  const download = () => {
    const url = chartRef.current?.toBase64Image("image/png", 1);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = "chart.png";
    a.click();
  };
  return (
    <VisualCard icon={BarChart3} title={title} code={code} onDownload={download} downloadLabel="Download PNG" bodyClassName="vetro-chart-body">
      <canvas ref={canvasRef} role="img" aria-label={title} />
    </VisualCard>
  );
}
