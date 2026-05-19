import React from 'react';
import './ThinkingIndicator.css';

export default function ThinkingIndicator({ isVisible = false }) {
  if (!isVisible) return null;

  return (
    <div className="claude-loader" style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '24px', paddingLeft: '4px' }}>
      <div className="claude-dot" style={{ animationDelay: '0s' }} />
      <div className="claude-dot" style={{ animationDelay: '0.2s' }} />
      <div className="claude-dot" style={{ animationDelay: '0.4s' }} />
      
      <style>{`
        .claude-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background-color: var(--accent, #d97757);
          animation: claudePulse 1.8s ease-in-out infinite;
          opacity: 0.35;
        }
        @keyframes claudePulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.35;
          }
          50% {
            transform: scale(1.4);
            opacity: 0.95;
          }
        }
      `}</style>
    </div>
  );
}

export function ThinkingInline({ text }) {
  return <ThinkingIndicator isVisible={true} />;
}
