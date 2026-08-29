import React, { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { downloadImage, shareImage } from "../utils/mediaDownloads";

export default function GeneratedImageResult({ src, prompt, onError }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (error) { onError?.(error.message || "Action failed."); }
    finally { setBusy(false); }
  };

  return (
    <div className="generated-image-result">
      <img src={src} alt={prompt || "Generated image"} loading="eager"
        style={{ display: "block", width: "100%", maxWidth: 768, height: "auto", borderRadius: 14 }} />
      <div className="generated-image-actions" style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="msg-action-btn" disabled={busy} title="Download image" aria-label="Download image"
          onClick={() => run(() => downloadImage(src))}>
          <Download size={16} />
        </button>
        <button className="msg-action-btn" disabled={busy} title="Share image" aria-label="Share image"
          onClick={() => run(async () => {
            const shared = await shareImage(src);
            if (!shared) await navigator.clipboard?.writeText(src);
          })}>
          <Share2 size={16} /><span>Share</span>
        </button>
      </div>
    </div>
  );
}
