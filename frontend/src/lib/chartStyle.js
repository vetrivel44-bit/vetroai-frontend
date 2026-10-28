// Chart.js styling for ```chartjs blocks (ChartBlock.jsx): the chat's palette
// and theme colours for whatever the model left out.

const SERIES = ["#1F9D7A", "#6D5BD0", "#E0703A", "#D19B1F", "#2F6FEB", "#D94F8A", "#4BA3C3", "#8A9A3B"];
const ROUND_TYPES = new Set(["pie", "doughnut", "polarArea"]);

// Fills in colours the model left out, for the current theme. Each dataset is
// styled by its own type, so a line drawn over bars (a combo chart) looks
// like a line; radar charts get their round "r" axis styled instead of x/y.
export function styleConfig(config, theme) {
  const ink = theme === "dark" ? "#D9D4CD" : "#3A352F";
  const grid = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const round = ROUND_TYPES.has(config.type);
  const radar = config.type === "radar";
  const datasets = config.data.datasets.map((ds, i) => {
    const color = SERIES[i % SERIES.length];
    const type = ds.type || config.type;
    const lineLike = type === "line" || type === "radar";
    const out = { ...ds };
    if (round) {
      if (out.backgroundColor == null) out.backgroundColor = (config.data.labels || ds.data || []).map((_, j) => SERIES[j % SERIES.length]);
      if (out.borderColor == null) out.borderColor = theme === "dark" ? "#262422" : "#FFFFFF";
    } else {
      if (out.backgroundColor == null) out.backgroundColor = lineLike ? `${color}33` : `${color}CC`;
      if (out.borderColor == null) out.borderColor = color;
      if (out.borderWidth == null) out.borderWidth = lineLike ? 2.5 : 1;
      if (lineLike && out.pointBackgroundColor == null) out.pointBackgroundColor = color;
      if (type === "line" && out.tension == null) out.tension = 0.3;
      if (type === "bar" && out.borderRadius == null) out.borderRadius = 6;
    }
    return out;
  });
  const options = config.options || {};
  const axis = (v = {}) => ({ ...v, ticks: { color: ink, ...(v.ticks || {}) }, grid: { color: grid, ...(v.grid || {}) }, title: v.title ? { color: ink, ...v.title } : v.title });
  const scales = round ? options.scales
    : radar ? { ...(options.scales || {}), r: { ...axis(options.scales?.r), angleLines: { color: grid, ...(options.scales?.r?.angleLines || {}) }, pointLabels: { color: ink, ...(options.scales?.r?.pointLabels || {}) }, ticks: { color: ink, backdropColor: "transparent", ...(options.scales?.r?.ticks || {}) } } }
    : Object.fromEntries(Object.entries({ x: {}, y: {}, ...(options.scales || {}) }).map(([k, v]) => [k, axis(v)]));
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
