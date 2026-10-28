import React from 'react';
import OrbitLoader from './OrbitLoader';
import './ThinkingIndicator.css';

// A boxless status line — the Orbit loader beside a bold status label. The
// motion lives in the entrance, the orbit, and a soft shimmer across the text.
export default function ThinkingIndicator({ isVisible = false, status = "Thinking" }) {
  if (!isVisible) return null;

  return (
    <div className="vai-thinking-card vai-enter">
      <OrbitLoader size={18} label={status} />
      <span className="vai-thinking-label">{status}</span>
    </div>
  );
}

export function ThinkingInline({ text }) {
  return <ThinkingIndicator isVisible={true} status={text} />;
}
