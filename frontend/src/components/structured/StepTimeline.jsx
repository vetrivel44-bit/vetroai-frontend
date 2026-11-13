import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import '../../styles/StructuredResponse.css';

// A step's title that is just a date ("30 Oct 2026", "Nov 2026", "2024",
// "March 5, 2026"): shown as the step's date, not as a heading.
const DATE_ONLY = /^(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{4}|(?:Q[1-4]\s+)?\d{4}(?:\s*[–-]\s*\d{2,4})?|\d{4}-\d{2}(?:-\d{2})?)$/;

/**
 * A timeline, drawn quietly inside the answer the way a well-written reply
 * lists dated events: a thin rule with small dots, the date in small muted
 * type, the event in plain text. No card, no invented "Phase 1" labels: a
 * step shows a date only when it has one.
 */
const StepTimeline = ({ title, steps = [] }) => {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="stl">
      {title && <div className="stl-title">{title}</div>}
      <ol className="stl-list">
        {steps.map((step, index) => {
          const heading = String(step.title || '').trim();
          const headingIsDate = DATE_ONLY.test(heading);
          const when = step.date || step.time || (headingIsDate ? heading : '');
          const text = step.description || step.content || '';
          return (
            <li key={index} className={`stl-item${step.completed ? ' is-done' : ''}`}>
              <span className="stl-dot" aria-hidden="true">{step.completed && <CheckCircle2 size={13} />}</span>
              <div className="stl-body">
                {(when || step.duration) && (
                  <div className="stl-when">{[when, step.duration].filter(Boolean).join(' · ')}</div>
                )}
                {heading && !headingIsDate && <div className="stl-head">{heading}</div>}
                {text && <p className="stl-text">{text}</p>}
                {step.tags?.length > 0 && (
                  <div className="stl-tags">{step.tags.map((tag, t) => <span key={t}>{tag}</span>)}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default StepTimeline;
