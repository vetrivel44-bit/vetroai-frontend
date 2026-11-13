import React from "react";
import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { READ_SPEEDS } from "../lib/voiceStream.js";
import "./ReadAloudBar.css";

const speedLabel = (speed) => `${speed}×`;

/**
 * The small bar under a reply while it's read aloud: pause/resume, back or
 * forward a sentence, speed, stop. Wraps onto two lines on a narrow phone
 * rather than scrolling sideways.
 */
export default function ReadAloudBar({ paused, speed, onToggle, onBack, onForward, onSpeed, onStop }) {
  return (
    <div className="rab" role="toolbar" aria-label="Read aloud controls" data-read-skip>
      <div className="rab-group">
        <button type="button" className="rab-btn" onClick={onBack} aria-label="Back one sentence" title="Back one sentence">
          <SkipBack size={15} />
        </button>
        <button type="button" className="rab-btn rab-main" onClick={onToggle} aria-label={paused ? "Resume reading" : "Pause reading"} title={paused ? "Resume" : "Pause"}>
          {paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
        </button>
        <button type="button" className="rab-btn" onClick={onForward} aria-label="Forward one sentence" title="Forward one sentence">
          <SkipForward size={15} />
        </button>
      </div>
      <div className="rab-speeds" role="radiogroup" aria-label="Reading speed">
        {READ_SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === speed}
            className={`rab-speed${value === speed ? " is-on" : ""}`}
            onClick={() => onSpeed(value)}
            title={`${value}× speed`}
          >
            {speedLabel(value)}
          </button>
        ))}
      </div>
      <button type="button" className="rab-btn rab-stop" onClick={onStop} aria-label="Stop reading" title="Stop">
        <Square size={13} fill="currentColor" />
      </button>
    </div>
  );
}
