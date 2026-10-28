import React from 'react';
import './ThinkingIndicator.css';

// A plain bordered status card, matching Copilot's minimal "Searching the
// web" / thinking card — bold status line, no icons, no gradients, no
// bouncing dots. The card itself barely announces itself; the motion lives
// in the entrance and in a soft shimmer sweep across the text.
export default function ThinkingIndicator({ isVisible = false, status = "Thinking" }) {
  if (!isVisible) return null;

  return (
    <div className="vai-thinking-card vai-enter">
      <span className="vai-thinking-label">{status}</span>
    </div>
  );
}

export function ThinkingInline({ text }) {
  return <ThinkingIndicator isVisible={true} status={text} />;
}
