import React, { useState } from "react";
import { Check, MessageCircleQuestion, Send, X } from "lucide-react";
import { choiceReply } from "../../../lib/choices";
import "./visuals.css";

// The clarifying question's answers, docked above the input box. One tap
// sends a single choice; multi-select and "Something else" send with the
// button. Closing it leaves the input box free to type anything.
export default function ChoicePanel({ data, onSend, onClose }) {
  const { question, options, multi, other } = data;
  const [picked, setPicked] = useState([]);
  const [otherOn, setOtherOn] = useState(false);
  const [otherText, setOtherText] = useState("");
  const reply = choiceReply(options, picked, otherOn ? otherText : "");

  const tap = (i) => {
    if (!multi) { onSend(options[i].label); return; }
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  };

  return (
    <div className="vetro-choice-panel" role="dialog" aria-label={question}>
      <div className="vetro-choice-q">
        <MessageCircleQuestion size={18} /> <span>{question}</span>
        <button type="button" className="vetro-choice-close" onClick={onClose} aria-label="Close and type instead"><X size={16} /></button>
      </div>
      {multi && <div className="vetro-choice-hint">Pick all that apply</div>}
      <div className="vetro-choice-list" role={multi ? "group" : "radiogroup"} aria-label={question}>
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={picked.includes(i)}
            className={`vetro-choice-opt${picked.includes(i) ? " is-picked" : ""}`}
            onClick={() => tap(i)}
          >
            <span className="vetro-choice-num">{picked.includes(i) ? <Check size={14} /> : i + 1}</span>
            <span className="vetro-choice-text">
              <strong>{o.label}</strong>
              {o.description && <small>{o.description}</small>}
            </span>
          </button>
        ))}
        {other && (otherOn ? (
          <form className="vetro-choice-other" onSubmit={(e) => { e.preventDefault(); if (reply) onSend(reply); }}>
            <input autoFocus value={otherText} onChange={(e) => setOtherText(e.target.value)} placeholder="Type your answer…" aria-label="Your own answer" />
          </form>
        ) : (
          <button type="button" className="vetro-choice-opt is-other" onClick={() => setOtherOn(true)}>
            <span className="vetro-choice-num">…</span>
            <span className="vetro-choice-text"><strong>Something else</strong><small>Type your own answer</small></span>
          </button>
        ))}
      </div>
      {(multi || otherOn) && (
        <div className="vetro-choice-actions">
          <button type="button" className="vetro-choice-send" disabled={!reply} onClick={() => onSend(reply)}>
            <Send size={14} /> Send
          </button>
        </div>
      )}
    </div>
  );
}
