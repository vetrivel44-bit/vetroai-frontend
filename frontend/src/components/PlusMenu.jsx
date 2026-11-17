import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Paintbrush, Paperclip, ScanText } from "lucide-react";

/**
 * The composer's + button, as in ChatGPT: a small menu to add photos and
 * files, to create an image (which starts "Create an image of " in the
 * message box, the request the app sends to its image model), to draw a
 * doodle that becomes a picture, or to open camera translate. Closes on a
 * choice, a tap outside or Escape.
 */
export default function PlusMenu({ onAddFiles, onCreateImage, onCameraTranslate, onDoodle }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const firstItem = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    firstItem.current?.focus();
    const outside = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);

  // Called straight from the tap, so the browser lets the file picker open.
  const choose = (action) => { setOpen(false); action?.(); };

  return (
    <div className="vc-plus-wrap" ref={wrap}>
      <button
        type="button"
        className="vc-round vc-fill vc-plus"
        onClick={() => setOpen((v) => !v)}
        title="Add photos and files, or create an image"
        aria-label="Add photos and files, or create an image"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15" /></svg>
      </button>
      {open && (
        <div className="vc-plus-menu" role="menu">
          <button type="button" role="menuitem" ref={firstItem} onClick={() => choose(onAddFiles)}>
            <Paperclip size={17} aria-hidden="true" />
            <span>Add photos &amp; files</span>
          </button>
          <button type="button" role="menuitem" onClick={() => choose(onCreateImage)}>
            <ImagePlus size={17} aria-hidden="true" />
            <span>Create image</span>
          </button>
          {onDoodle && (
            <button type="button" role="menuitem" onClick={() => choose(onDoodle)}>
              <Paintbrush size={17} aria-hidden="true" />
              <span>Doodle to picture</span>
            </button>
          )}
          {onCameraTranslate && (
            <button type="button" role="menuitem" onClick={() => choose(onCameraTranslate)}>
              <ScanText size={17} aria-hidden="true" />
              <span>Camera translate</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
