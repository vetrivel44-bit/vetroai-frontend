import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "lucide-react";
import VisualCard, { VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { buildThreeDocument, threeTitle } from "../../../lib/threeStage";
import { useDocumentTheme } from "./useDocumentTheme";

// A ```3d block: an interactive Three.js model drawn right in the reply —
// drag to turn it, pinch to zoom, tabs when there are several models. The
// model's code runs in a sandboxed iframe (allow-scripts only, opaque origin)
// like the ```html widget, so it can't reach the app, its storage or login.

let frameCount = 0;
let threeSource = null;

// Three.js (~750 KB) is fetched the first time a 3D block appears.
function loadThree() {
  if (!threeSource) {
    threeSource = import("virtual:three-classic").then((m) => m.default).catch((err) => {
      threeSource = null;
      throw err;
    });
  }
  return threeSource;
}

export default function ThreeBlock({ code }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const theme = useDocumentTheme();
  const frameRef = useRef(null);
  const [frameId] = useState(() => `vetro-3d-${++frameCount}`);
  const [three, setThree] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [height, setHeight] = useState(360);

  useEffect(() => {
    if (pending) return undefined;
    let alive = true;
    loadThree().then((src) => { if (alive) setThree(src); }, () => { if (alive) setLoadError("the 3D engine didn't load — check your connection"); });
    return () => { alive = false; };
  }, [pending]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.source !== "vetro-3d" || data.id !== frameId) return;
      if (data.type === "height") setHeight(Math.min(1200, Math.max(200, Number(data.height) || 0)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameId]);

  const srcDoc = useMemo(
    () => (three && !pending ? buildThreeDocument({ three, code, frameId, theme }) : ""),
    [three, code, frameId, theme, pending],
  );

  if (pending) return <VisualPending icon={Box} label="Building 3D model…" sketch="diagram" />;
  return (
    <VisualCard icon={Box} title={threeTitle(code)} code={code}>
      {loadError ? (
        <div className="vetro-diagram-error">Couldn’t show this 3D model ({loadError}).</div>
      ) : !srcDoc ? (
        <div className="vetro-three-loading">Loading 3D…</div>
      ) : (
        <iframe
          ref={frameRef}
          title={threeTitle(code)}
          className="vetro-three-frame"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{ height }}
        />
      )}
    </VisualCard>
  );
}
