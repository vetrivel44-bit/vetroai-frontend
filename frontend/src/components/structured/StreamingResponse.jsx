import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StructuredResponseRenderer from './StructuredResponseRenderer';
import '../../styles/StructuredResponse.css';

const StreamingResponse = ({ content, isStreaming, onComplete, onSubmitCode }) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [showStructured, setShowStructured] = useState(false);
  const [thinkStep, setThinkStep] = useState(0);

  const thinkingSteps = [
    "Analyzing input request...",
    "Retrieving knowledge context...",
    "Designing response architecture...",
    "Synthesizing modular insights...",
    "Polishing structured output..."
  ];

  const progressPct = useMemo(() => {
    if (!content || content.length === 0) return 0;
    return Math.round((displayedContent?.length || 0) / content.length * 100);
  }, [content, displayedContent]);

  useEffect(() => {
    let stepInterval;
    if (isStreaming) {
      stepInterval = setInterval(() => {
        setThinkStep(prev => (prev + 1) % thinkingSteps.length);
      }, 1800);
    }
    return () => clearInterval(stepInterval);
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming) {
      let currentIndex = 0;
      const targetContent = content || "";
      
      // If it's pure JSON (starts with ``` or {), skip streaming to prevent raw code from showing
      const isPureJson = targetContent.trim().startsWith('```') || (targetContent.trim().startsWith('{') && targetContent.trim().endsWith('}'));
      
      if (isPureJson) {
        setDisplayedContent("");
        setShowStructured(true);
        onComplete?.();
        return;
      }
      
      const streamInterval = setInterval(() => {
        if (currentIndex < targetContent.length) {
          const nextIndex = Math.min(currentIndex + Math.floor(Math.random() * 3) + 2, targetContent.length);
          setDisplayedContent(targetContent.slice(0, nextIndex));
          currentIndex = nextIndex;
        } else {
          clearInterval(streamInterval);
          const timer = setTimeout(() => {
            setShowStructured(true);
            onComplete?.();
          }, 600);
          return () => clearTimeout(timer);
        }
      }, 10 + Math.random() * 20);

      return () => clearInterval(streamInterval);
    } else {
      setDisplayedContent(content || "");
      const timer = setTimeout(() => setShowStructured(true), 300);
      return () => clearTimeout(timer);
    }
  }, [content, isStreaming, onComplete]);

  const hasLocation = useMemo(() => {
    const c = (content || "").toLowerCase();
    return c.includes('location') || c.includes('map') || c.includes('where is') || c.includes('address');
  }, [content]);

  const hasGallery = useMemo(() => {
    const c = (content || "").toLowerCase();
    return c.includes('gallery') || c.includes('image') || c.includes('photo');
  }, [content]);

  return (
    <div className="structured-response-container">
      <AnimatePresence mode="wait">
        {!showStructured ? (
          <motion.div
            key="streaming"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -10, filter: 'blur(10px)', transition: { duration: 0.4 } }}
            className="structured-response"
          >
            <div className="structured-section" style={{ 
              border: '1px solid var(--structured-border)', 
              padding: '48px',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
            }}>
              <div className="stream-progress-container" style={{ marginBottom: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem', color: 'var(--structured-text-secondary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  <span>VetroAI Reasoning</span>
                  <span>{progressPct}%</span>
                </div>
                <div style={{ height: '2px', width: '100%', background: 'var(--structured-border)', borderRadius: '2px', overflow: 'hidden' }}>
                  <motion.div 
                    style={{ height: '100%', background: 'var(--structured-accent)', boxShadow: '0 0 10px var(--structured-accent)' }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ type: 'spring', stiffness: 50, damping: 20 }}
                  />
                </div>
              </div>

              <div style={{ 
                minHeight: '80px',
                fontFamily: 'var(--structured-font)',
                fontSize: '1.25rem',
                lineHeight: '1.6',
                color: 'var(--structured-text-primary)',
                position: 'relative',
                fontWeight: 300
              }}>
                <span style={{ opacity: 0.9, whiteSpace: 'pre-wrap' }}>{displayedContent}</span>
                {isStreaming && (
                  <motion.span
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                    style={{ 
                      display: 'inline-block',
                      width: '4px',
                      height: '1.1em',
                      background: 'var(--structured-accent)',
                      marginLeft: '6px',
                      verticalAlign: 'middle',
                      boxShadow: '0 0 8px var(--structured-accent)'
                    }}
                  />
                )}
              </div>
              
              <div className="thinking-staged" style={{ marginTop: '48px', borderTop: '1px solid var(--structured-border)', paddingTop: '24px' }}>
                <motion.div 
                   key={thinkStep}
                  className="thinking-step"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  style={{ color: 'var(--structured-accent)', fontSize: '0.9rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '12px' }}
                >
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1], rotate: [0, 180, 360] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    style={{ width: '8px', height: '8px', border: '2px solid var(--structured-accent)', borderRadius: '2px' }} 
                  />
                  <span>{thinkingSteps[thinkStep]}</span>
                </motion.div>
              </div>

              {(hasLocation || hasGallery) && (
                <div style={{ marginTop: '40px', opacity: 0.15 }}>
                  {hasLocation && (
                    <div className="map-skeleton" style={{ marginBottom: '24px' }} />
                  )}
                  {hasGallery && (
                    <div style={{ display: 'flex', gap: '20px' }}>
                      {[1, 2, 3].map(i => (
                        <div key={i} className="map-skeleton" style={{ flex: '1', height: '140px' }} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="structured"
            initial={{ opacity: 0, scale: 1.02, filter: 'blur(20px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 1.2, ease: [0.23, 1, 0.32, 1] }}
            style={{ width: '100%' }}
          >
            <StructuredResponseRenderer response={content} onSubmitCode={onSubmitCode} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StreamingResponse;
