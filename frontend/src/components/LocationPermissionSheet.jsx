import React, { useEffect, useRef } from "react";
import { Navigation } from "lucide-react";
import "./LocationPermissionSheet.css";

/**
 * Asks before VetroAI reads the precise location, the first time a reply
 * needs it ("restaurants near me"). `onChoose` gets "always", "once" or
 * "decline". The browser's own location prompt may still follow the first
 * time — this sheet is VetroAI asking, that one is the browser.
 */
export default function LocationPermissionSheet({ onChoose }) {
  const primaryRef = useRef(null);

  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onChoose("decline"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChoose]);

  return (
    <div className="lps-backdrop" onClick={() => onChoose("decline")}>
      <div className="lps-sheet" role="dialog" aria-modal="true" aria-labelledby="lps-title" onClick={(e) => e.stopPropagation()}>
        <p className="lps-kicker" id="lps-title">VetroAI wants access to</p>
        <div className="lps-item">
          <Navigation size={22} />
          <div>
            <strong>Location</strong>
            <span>Check your precise location</span>
          </div>
        </div>
        <p className="lps-why">VetroAI will use your location to find places near you and give answers that fit where you are.</p>
        <div className="lps-actions">
          <button type="button" className="lps-btn" onClick={() => onChoose("always")}>Always allow</button>
          <button type="button" className="lps-btn is-primary" ref={primaryRef} onClick={() => onChoose("once")}>Allow once</button>
          <button type="button" className="lps-btn" onClick={() => onChoose("decline")}>Decline</button>
        </div>
        <p className="lps-note">You can change this anytime in Settings → Data controls.</p>
      </div>
    </div>
  );
}
