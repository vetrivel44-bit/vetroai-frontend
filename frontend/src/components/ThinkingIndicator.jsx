import React from 'react';
import './ThinkingIndicator.css';

export default function ThinkingIndicator({ isVisible = false, status = "Thinking" }) {
  if (!isVisible) return null;

  return (
    <div className="vai-thinking-container vai-enter">
      <div className="vai-thinking-glow" />
      <div className="vai-thinking-inner">
        <div className="vai-thinking-icon">
          <svg className="vai-sparkle-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path className="vai-star-main" d="M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5L12 3Z" fill="url(#sparkle-grad)" />
            <defs>
              <linearGradient id="sparkle-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#60a5fa" />
                <stop offset="50%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#fbbf24" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className="vai-thinking-text-wrap">
          <span className="vai-thinking-text">{status}</span>
          <span className="vai-dots">
            <span className="vai-dot" />
            <span className="vai-dot" />
            <span className="vai-dot" />
          </span>
        </div>
      </div>
      <div className="vai-thinking-shimmer" />
    </div>
  );
}

export function ThinkingInline({ text }) {
  return <ThinkingIndicator isVisible={true} status={text} />;
}
