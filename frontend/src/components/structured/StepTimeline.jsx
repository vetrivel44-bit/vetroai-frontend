import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, CheckCircle2, Clock } from 'lucide-react';
import '../../styles/StructuredResponse.css';

const StepTimeline = ({ title, steps = [], delay = 0 }) => {
  if (!steps || steps.length === 0) return null;

  return (
    <motion.div 
      className="structured-timeline-container"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, delay }}
    >
      {title && (
        <div className="timeline-header" style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--structured-accent)' }}>
            <Calendar size={20} />
            <h2 style={{ fontSize: '1.25rem', fontWeight: '800', margin: 0, color: 'var(--structured-text-primary)' }}>{title}</h2>
          </div>
        </div>
      )}

      <div className="structured-timeline">
        {steps.map((step, index) => (
          <motion.div 
            key={index}
            className="structured-timeline-item"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: delay + (index * 0.1) }}
          >
            <div className="timeline-dot-wrapper">
              {step.completed ? (
                <CheckCircle2 size={18} className="timeline-icon-success" />
              ) : (
                <div className="timeline-dot" />
              )}
            </div>
            
            <div className="timeline-content">
              <div className="timeline-meta">
                <span className="timeline-date">{step.date || step.time || `Phase ${index + 1}`}</span>
                {step.duration && (
                  <span className="timeline-duration">
                    <Clock size={10} />
                    {step.duration}
                  </span>
                )}
              </div>
              <h4>{step.title}</h4>
              <p>{step.description || step.content}</p>
              
              {step.tags && step.tags.length > 0 && (
                <div className="timeline-tags">
                  {step.tags.map((tag, tIdx) => (
                    <span key={tIdx} className="timeline-tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

export default StepTimeline;
