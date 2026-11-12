// Generated images in the chat: the animated placeholder while Gemini 3.1
// Flash Lite Image works, and the finished image with Edit / Download / Share
// and a full-screen view.
import { useEffect, useRef, useState } from "react";
import { Download, Share2, Pencil, Maximize2, X, ArrowUp } from "lucide-react";
import { IMAGE_MODEL_NAME } from "../../lib/imageGen";
import "./GeneratedImage.css";

const CREATE_STEPS = ["Reading your prompt", "Sketching the composition", "Adding detail", "Refining light and colour", "Finishing touches"];
const EDIT_STEPS = ["Looking at your image", "Applying your changes", "Blending the edit", "Finishing touches"];

/** The placeholder shown while an image is being made or edited. */
export function ImageGenLoader({ mode = "create", sourceUrl }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const steps = mode === "edit" ? EDIT_STEPS : CREATE_STEPS;
  const step = steps[Math.min(Math.floor(seconds / 4), steps.length - 1)];

  return (
    <div className="gi-wrap" role="status" aria-live="polite">
      <div className="gi-status">
        <span className="gi-status-text">{mode === "edit" ? "Editing image" : "Creating image"}</span>
        <span className="gi-status-step" key={step}>{step}{seconds >= 3 ? ` · ${seconds}s` : ""}</span>
      </div>
      <div className="gi-loader">
        {sourceUrl && <img className="gi-loader-source" src={sourceUrl} alt="" aria-hidden="true" />}
        <div className="gi-blob gi-blob-a" />
        <div className="gi-blob gi-blob-b" />
        <div className="gi-blob gi-blob-c" />
        <div className="gi-grain" />
        <div className="gi-sweep" />
      </div>
    </div>
  );
}

const fileName = (prompt) => {
  const slug = String(prompt || "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
  return `vetroai-${slug}.png`;
};

async function toBlob(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error("Could not read the image.");
  return res.blob();
}

/** A finished image with its actions. onEdit(changes) asks for an edited copy. */
export function GeneratedImage({ src, prompt, caption, onEdit, onNotify, busy }) {
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const inputRef = useRef(null);
  const notify = (text, type = "info") => onNotify?.(text, type, 2500);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const download = async () => {
    try {
      const url = URL.createObjectURL(await toBlob(src));
      const a = Object.assign(document.createElement("a"), { href: url, download: fileName(prompt) });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      notify("Download failed. Try again.", "error");
    }
  };

  const share = async () => {
    try {
      const blob = await toBlob(src);
      const file = new File([blob], fileName(prompt), { type: blob.type || "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: prompt || "Image from VetroAI" });
        return;
      }
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ [file.type]: blob })]);
        notify("Image copied — paste it anywhere to share", "success");
        return;
      }
      await download();
    } catch (err) {
      if (err?.name !== "AbortError") notify("Sharing isn't available here. Download it instead.", "error");
    }
  };

  const submitEdit = (e) => {
    e?.preventDefault();
    const text = changes.trim();
    if (!text || busy) return;
    onEdit?.(text);
    setChanges("");
    setEditing(false);
  };

  return (
    <div className="gi-wrap">
      {caption && <p className="gi-caption">{caption}</p>}
      <div className={`gi-frame${loaded ? " is-loaded" : ""}`}>
        <img
          src={src}
          alt={prompt || "Generated image"}
          loading="eager"
          onLoad={() => setLoaded(true)}
          onClick={() => setFullscreen(true)}
        />
        <div className="gi-overlay">
          <button type="button" className="gi-icon-btn" onClick={() => setFullscreen(true)} title="View full size" aria-label="View full size"><Maximize2 size={16} /></button>
        </div>
      </div>

      <div className="gi-actions">
        {onEdit && (
          <button type="button" className={`gi-btn${editing ? " is-active" : ""}`} onClick={() => setEditing((v) => !v)} disabled={busy}>
            <Pencil size={15} /> Edit
          </button>
        )}
        <button type="button" className="gi-btn" onClick={download}><Download size={15} /> Download</button>
        <button type="button" className="gi-btn" onClick={share}><Share2 size={15} /> Share</button>
        <span className="gi-model">{IMAGE_MODEL_NAME}</span>
      </div>

      {editing && (
        <form className="gi-edit" onSubmit={submitEdit}>
          <input
            ref={inputRef}
            value={changes}
            onChange={(e) => setChanges(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            placeholder="Describe the changes — e.g. make the sky orange, add a hat"
            aria-label="Describe the changes to the image"
          />
          <button type="submit" className="gi-send" disabled={!changes.trim() || busy} aria-label="Apply changes"><ArrowUp size={16} /></button>
        </form>
      )}

      {fullscreen && (
        <div className="gi-lightbox" onClick={() => setFullscreen(false)} role="dialog" aria-label="Image full size">
          <img src={src} alt={prompt || "Generated image"} onClick={(e) => e.stopPropagation()} />
          <div className="gi-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="gi-btn gi-btn-dark" onClick={download}><Download size={15} /> Download</button>
            <button type="button" className="gi-btn gi-btn-dark" onClick={share}><Share2 size={15} /> Share</button>
            <button type="button" className="gi-icon-btn gi-btn-dark" onClick={() => setFullscreen(false)} aria-label="Close"><X size={18} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
