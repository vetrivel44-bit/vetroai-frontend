import React, { useState, useRef, useEffect } from "react";
import { Download, Share2, ChevronDown } from "lucide-react";
import { downloadImageWithFormat, shareImage } from "../utils/mediaDownloads";

export default function GeneratedImageResult({ src, prompt, onError }) {
  const [busy, setBusy] = useState(false);
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const formatMenuRef = useRef(null);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setShowFormatMenu(false);
    } catch (error) {
      onError?.(error.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (formatMenuRef.current && !formatMenuRef.current.contains(e.target)) {
        setShowFormatMenu(false);
      }
    };

    if (showFormatMenu) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [showFormatMenu]);

  return (
    <div className="generated-image-result">
      <img
        src={src}
        alt={prompt || "Generated image"}
        loading="eager"
        style={{ display: "block", width: "100%", maxWidth: 768, height: "auto", borderRadius: 14 }}
      />
      <div
        className="generated-image-actions"
        style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}
      >
        <div style={{ position: "relative" }} ref={formatMenuRef}>
          <button
            className="msg-action-btn"
            disabled={busy}
            title="Download image"
            aria-label="Download image"
            onClick={() => setShowFormatMenu(!showFormatMenu)}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <Download size={16} />
            <ChevronDown size={14} />
          </button>

          {showFormatMenu && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
                backgroundColor: "var(--bg-secondary, #f5f5f5)",
                border: "1px solid var(--border-color, #ddd)",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                zIndex: 1000,
                minWidth: 120,
              }}
            >
              {["png", "jpg", "webp"].map((format) => (
                <button
                  key={format}
                  className="msg-action-btn"
                  onClick={() =>
                    run(() =>
                      downloadImageWithFormat(src, format)
                    )
                  }
                  disabled={busy}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    border: "none",
                    backgroundColor: "transparent",
                    cursor: busy ? "not-allowed" : "pointer",
                    fontSize: 14,
                  }}
                >
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="msg-action-btn"
          disabled={busy}
          title="Share image"
          aria-label="Share image"
          onClick={() =>
            run(async () => {
              const shared = await shareImage(src);
              if (!shared) await navigator.clipboard?.writeText(src);
            })
          }
        >
          <Share2 size={16} />
          <span>Share</span>
        </button>
      </div>
    </div>
  );
}
