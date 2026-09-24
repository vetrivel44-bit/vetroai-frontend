import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppWindow } from "lucide-react";
import VisualCard, { VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { useDocumentTheme } from "./useDocumentTheme";

// A ```html widget block: a small self-contained tool or mockup (calculator,
// converter, form preview…) running inside a sandboxed iframe.
//
// sandbox="allow-scripts allow-forms" without allow-same-origin: the widget's
// scripts run, but in an opaque origin — no access to VetroAI's cookies,
// storage, login or page, and it can't navigate the app. allow-forms lets
// calculators built on <form> work; submitting only ever reloads the frame.

let widgetCount = 0;

function buildDocument(html, frameId, theme) {
  const dark = theme === "dark";
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: ${dark ? "dark" : "light"}; }
  html, body { margin: 0; }
  body { padding: 16px; font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.5;
         color: ${dark ? "#ECE9E4" : "#1F1D1A"}; background: ${dark ? "#262422" : "#FFFFFF"}; }
  input, select, textarea, button { font: inherit; }
</style>
<script>(function () {
  // Sandboxed without same-origin, reading storage throws — give the widget
  // working in-memory storage instead of crashing it.
  function mem() { var d = {}; return { getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; }, setItem: function (k, v) { d[String(k)] = String(v); }, removeItem: function (k) { delete d[String(k)]; }, clear: function () { d = {}; }, key: function (i) { return Object.keys(d)[i] || null; }, get length() { return Object.keys(d).length; } }; }
  ["localStorage", "sessionStorage"].forEach(function (n) { try { window[n].getItem("x"); } catch (e) { try { Object.defineProperty(window, n, { value: mem(), configurable: true }); } catch (e2) {} } });
  // Report the content height so the frame fits it exactly.
  var last = 0;
  function report() {
    var h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    if (h && Math.abs(h - last) > 1) { last = h; parent.postMessage({ source: "vetro-widget", id: ${JSON.stringify(frameId)}, height: h }, "*"); }
  }
  window.addEventListener("load", report);
  document.addEventListener("DOMContentLoaded", function () {
    report();
    if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
  });
  setInterval(report, 800);
})();</script>`;
  const doc = String(html || "");
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (tag) => `${tag}${head}`);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${doc}</body></html>`;
}

const widgetTitle = (html) => {
  const title = /<title[^>]*>([^<]{1,60})<\/title>/i.exec(html)?.[1] || /<h1[^>]*>([^<]{1,60})<\/h1>/i.exec(html)?.[1];
  return (title || "Widget").trim();
};

export default function WidgetBlock({ code }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const theme = useDocumentTheme();
  const frameRef = useRef(null);
  const [frameId] = useState(() => `vetro-widget-${++widgetCount}`);
  const [height, setHeight] = useState(160);
  const srcDoc = useMemo(() => (pending ? "" : buildDocument(code, frameId, theme)), [code, frameId, theme, pending]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.source !== "vetro-widget" || data.id !== frameId) return;
      setHeight(Math.min(1400, Math.max(60, Number(data.height) || 0)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameId]);

  if (pending) return <VisualPending icon={AppWindow} label="Building widget…" />;
  return (
    <VisualCard icon={AppWindow} title={widgetTitle(code)} code={code}>
      <iframe
        ref={frameRef}
        title={widgetTitle(code)}
        className="vetro-widget-frame"
        sandbox="allow-scripts allow-forms"
        srcDoc={srcDoc}
        style={{ height }}
        loading="lazy"
      />
    </VisualCard>
  );
}
