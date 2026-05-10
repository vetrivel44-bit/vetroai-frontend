import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Pencil, X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import '../../styles/StructuredResponse.css';

const OnboardingCard = ({ step, question, options = [], onSelect, totalSteps = 4, delay = 0 }) => {
  const [selected, setSelected] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [customAnswer, setCustomAnswer] = useState('');
  const cardRef = useRef(null);

  const handleSelect = (value) => {
    if (!submitted) {
      setSelected(value);
      setSubmitted(true);
      if (onSelect) {
        onSelect(value);
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (submitted) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev < options.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < options.length) {
          handleSelect(options[activeIndex]);
        } else if (customAnswer.trim()) {
          handleSelect(customAnswer.trim());
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleSelect('skip');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, options, customAnswer, submitted]);

  if (submitted) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ 
          color: '#06D6A0', 
          fontWeight: '600', 
          fontSize: '0.9rem',
          marginTop: '8px',
          padding: '4px 0',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <Check size={14} /> {selected}
      </motion.div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: '680px' }}>
      <motion.div 
        ref={cardRef}
        className="onboarding-card"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay }}
        style={{ 
          background: '#ffffff', 
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #e0e0e0', 
          marginTop: '12px', 
          color: '#333333',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
          width: '100%'
        }}
      >
        {/* Header Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '500', color: '#1a1a1a', margin: 0 }}>{question}</h3>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#666666', fontSize: '14px' }}>
              <button style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px', color: '#999999' }}><ChevronLeft size={16} /></button>
              <span>{step} of {totalSteps}</span>
              <button style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px', color: '#999999' }}><ChevronRight size={16} /></button>
            </div>
            <button style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px', color: '#999999' }}><X size={16} /></button>
          </div>
        </div>

        {/* Options List */}
        <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid #f0f0f0' }}>
          {options.map((option, index) => {
            const isActive = index === activeIndex;
            return (
              <div
                key={index}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                  background: isActive ? '#f5f5f5' : 'transparent',
                  transition: 'background 0.2s ease'
                }}
              >
                <span style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  background: '#f0f0f0',
                  color: '#666666',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: '600',
                  marginRight: '12px'
                }}>
                  {index + 1}
                </span>
                <span style={{ fontSize: '14px', color: '#333333' }}>{option}</span>
              </div>
            );
          })}
        </div>

        {/* Bottom Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <Pencil size={14} color="#999999" />
            <input
              type="text"
              placeholder="Something else"
              value={customAnswer}
              onChange={(e) => {
                setCustomAnswer(e.target.value);
                setActiveIndex(-1);
              }}
              style={{
                border: 'none',
                outline: 'none',
                fontSize: '14px',
                color: '#333333',
                width: '100%',
                background: 'transparent'
              }}
            />
          </div>
          <button
            onClick={() => handleSelect('skip')}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: '#0066FF',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Skip
          </button>
        </div>
      </motion.div>

      {/* Footer (Keyboard Hints) */}
      <div style={{ marginTop: '8px', color: '#999999', fontSize: '12px', textAlign: 'left', paddingLeft: '4px' }}>
        ↑↓ to navigate · Enter to select · Esc to skip
      </div>
    </div>
  );
};

export default OnboardingCard;
