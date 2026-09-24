import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { useDocumentTheme } from "./useDocumentTheme";

// A ```chartjs block: Chart.js config as JSON (bar, line, scatter, pie…).
// Chart.js loads the first time a chart appears.

const SERIES = ["#1F9D7A", "#6D5BD0", "#E0703A", "#D19B1F", "#2F6FEB", "#D94F8A", "#4BA3C3", "#8A9A3B"];
const ROUND_TYPES = new Set(["pie", "doughnut", "polarArea"]);

function parseConfig(code) {
  const config = JSON.parse(code);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("expected a JSON object");
  if (typeof config.type !== "string") throw new Error("missing \"type\"");
  if (!config.data || !Array.isArray(config.data.datasets)) throw new Error("missing \"data.datasets\"");
  return config;
}

// Fills in colours the model left out, for the current theme.
function styleConfig(config, theme) {
  const ink = theme === "dark" ? "#D9D4CD" : "#3A352F";
  const grid = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const round = ROUND_TYPES.has(config.type);
  const datasets = config.data.datasets.map((ds, i) => {
    const color = SERIES[i % SERIES.length];
    const out = { ...ds };
    if (round) {
      if (out.backgroundColor == null) out.backgroundColor = (config.data.labels || ds.data || []).map((_, j) => SERIES[j % SERIES.length]);
      if (out.borderColor == null) out.borderColor = theme === "dark" ? "#262422" : "#FFFFFF";
    } else {
      if (out.backgroundColor == null) out.backgroundColor = config.type === "line" ? `${color}33` : `${color}CC`;
      if (out.borderColor == null) out.borderColor = color;
      if (out.borderWidth == null) out.borderWidth = config.type === "line" ? 2.5 : 1;
      if (config.type === "line" && out.tension == null) out.tension = 0.3;
      if (config.type === "bar" && out.borderRadius == null) out.borderRadius = 6;
    }
    return out;
  });
  const options = config.options || {};
  const scales = round ? options.scales : Object.fromEntries(
    Object.entries({ x: {}, y: {}, ...(options.scales || {}) }).map(([k, v]) => [k, { ...v, ticks: { color: ink, ...(v.ticks || {}) }, grid: { color: grid, ...(v.grid || {}) } }]),
  );
  return {
    ...config,
    data: { ...config.data, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...options,
      ...(scales ? { scales } : {}),
      plugins: {
        ...(options.plugins || {}),
        legend: { ...(options.plugins?.legend || {}), labels: { color: ink, ...(options.plugins?.legend?.labels || {}) } },
        title: options.plugins?.title ? { color: ink, ...options.plugins.title } : undefined,
      },
    },
  };
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

  if (pending) return <VisualPending icon={BarChart3} label="Drawing chart…" />;
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
