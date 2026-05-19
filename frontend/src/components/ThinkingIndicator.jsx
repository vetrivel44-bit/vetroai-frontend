import React from 'react';
import './ThinkingIndicator.css';

export default function ThinkingIndicator({ isVisible = false }) {
  if (!isVisible) return null;

  return (
    <div className="minimal-thinking-container" style={{ display: 'flex', alignItems: 'center', height: '24px', paddingLeft: '2px' }}>
      <div 
        className="minimal-pulse-dot" 
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: 'var(--accent)',
          animation: 'pulse-opacity 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
        }}
      />
      <style>{`
        @keyframes pulse-opacity {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}

export function ThinkingInline({ text }) {
  return <ThinkingIndicator isVisible={true} />;
}
