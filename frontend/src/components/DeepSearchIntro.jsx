import React from "react";
import { ArrowRight, BookOpen, Compass, PenLine, Search, ShieldCheck, Telescope } from "lucide-react";
import "./DeepSearchIntro.css";

const FLOW = [
  { icon: Compass, label: "Plan the angles" },
  { icon: Search, label: "Search each one" },
  { icon: BookOpen, label: "Read sources in full" },
  { icon: ShieldCheck, label: "Cross-check claims" },
  { icon: PenLine, label: "Write a cited report" },
];

/** What DeepSearch does, shown above the input when the mode is picked. */
export default function DeepSearchIntro() {
  return (
    <div className="vai-dsi">
      <span className="vai-dsi-badge"><Telescope size={14} strokeWidth={2.2} /> DeepSearch</span>
      <h2 className="vai-dsi-title">Research anything, in depth</h2>
      <p className="vai-dsi-sub">
        Plans the angles, reads dozens of sources, cross-checks the key claims and
        writes a report with citations. Takes a minute or two.
      </p>
      <ol className="vai-dsi-flow" aria-label="How DeepSearch works">
        {FLOW.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.label} style={{ "--i": i }}>
              <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Example research questions, as cards. */
export function DeepSearchExamples({ examples, onPick }) {
  if (!examples?.length) return null;
  return (
    <div className="vai-dsi-examples">
      {examples.slice(0, 4).map((question) => (
        <button key={question} type="button" className="vai-dsi-example" onClick={() => onPick(question)}>
          <span className="vai-dsi-example-text">{question}</span>
          <span className="vai-dsi-example-go"><Telescope size={12} strokeWidth={2.2} /> Research <ArrowRight size={12} strokeWidth={2.2} /></span>
        </button>
      ))}
    </div>
  );
}
