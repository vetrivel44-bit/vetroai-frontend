import React, { useState, useEffect, useRef, useMemo } from 'react';
import './ThinkingIndicator.css';

const THINKING_STATUSES = [
  'Thinking',
  'Assessing User Needs',
  'Analyzing Context',
  'Searching Memory',
  'Preparing Response',
  'Optimizing Answer',
  'Finalizing Output',
];

// Animated sparkle/star SVG with blue + yellow gradient
function SparkleIcon({ size = 24 }) {
  return (
    <div className="vai-sparkle-container">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="vai-sparkle-svg"
      >
        <defs>
          <linearGradient id="sparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="50%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
          <filter id="sparkleGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feFlood floodColor="#60a5fa" floodOpacity="0.6" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Main star */}
        <path
          d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5Z"
          fill="url(#sparkleGrad)"
          filter="url(#sparkleGlow)"
          className="vai-star-main"
        />
        {/* Small star top-right */}
        <path
          d="M19 3L19.6 5.4L22 6L19.6 6.6L19 9L18.4 6.6L16 6L18.4 5.4Z"
          fill="#fbbf24"
          opacity="0.9"
          className="vai-star-small-1"
        />
        {/* Small star bottom-left */}
        <path
          d="M5 15L5.4 16.6L7 17L5.4 17.4L5 19L4.6 17.4L3 17L4.6 16.6Z"
          fill="#60a5fa"
          opacity="0.8"
          className="vai-star-small-2"
        />
      </svg>
      {/* Orbiting particles */}
      <div className="vai-orbit-ring">
        <div className="vai-orbit-dot vai-orbit-dot-1" />
        <div className="vai-orbit-dot vai-orbit-dot-2" />
        <div className="vai-orbit-dot vai-orbit-dot-3" />
      </div>
    </div>
  );
}

// Animated dots component
function AnimatedDots() {
  return (
    <span className="vai-dots">
      <span className="vai-dot" />
      <span className="vai-dot" />
      <span className="vai-dot" />
    </span>
  );
}

export default function ThinkingIndicator({ isVisible = false, customStatuses }) {
  const [statusIndex, setStatusIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [show, setShow] = useState(false);
  const intervalRef = useRef(null);
  const statuses = customStatuses || THINKING_STATUSES;

  // Entrance/exit animation
  useEffect(() => {
    if (isVisible) {
      setShow(true);
      setStatusIndex(0);
    } else {
      const timeout = setTimeout(() => setShow(false), 400);
      return () => clearTimeout(timeout);
    }
  }, [isVisible]);

  // Cycle through statuses
  useEffect(() => {
    if (!isVisible) return;

    intervalRef.current = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setStatusIndex((prev) => (prev + 1) % statuses.length);
        setIsTransitioning(false);
      }, 300);
    }, 2800);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isVisible, statuses.length]);

  if (!show) return null;

  return (
    <div className={`vai-thinking-container ${isVisible ? 'vai-enter' : 'vai-exit'}`}>
      <div className="vai-thinking-inner">
        {/* Glow backdrop */}
        <div className="vai-thinking-glow" />
        
        {/* Sparkle icon */}
        <div className="vai-thinking-icon">
          <SparkleIcon size={22} />
        </div>

        {/* Status text */}
        <div className="vai-thinking-text-wrap">
          <span
            className={`vai-thinking-text ${isTransitioning ? 'vai-text-exit' : 'vai-text-enter'}`}
            key={statusIndex}
          >
            {statuses[statusIndex]}
          </span>
          <AnimatedDots />
        </div>
      </div>

      {/* Progress shimmer bar */}
      <div className="vai-thinking-shimmer" />
    </div>
  );
}

// Compact inline version for use inside message bubbles
export function ThinkingInline({ text = 'Thinking' }) {
  return (
    <div className="vai-thinking-inline">
      <div className="vai-thinking-inline-icon">
        <SparkleIcon size={16} />
      </div>
      <span className="vai-thinking-inline-text">
        {text}
        <AnimatedDots />
      </span>
    </div>
  );
}
