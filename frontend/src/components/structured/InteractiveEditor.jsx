import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import '../../styles/StructuredResponse.css';

const InteractiveEditor = ({ language, signature, questionNumber, totalQuestions, onSubmit, delay = 0 }) => {
  const [code, setCode] = useState(signature || '');
  const [submitted, setSubmitted] = useState(false);
  const [warning, setWarning] = useState('');

  useEffect(() => {
    if (signature) {
      setCode(signature);
    }
  }, [signature]);

  const getLanguageExtension = (lang) => {
    switch (lang?.toLowerCase()) {
      case 'python': return [python()];
      case 'javascript': return [javascript()];
      case 'java': return [java()];
      case 'c++': return [cpp()];
      case 'cpp': return [cpp()];
      default: return [];
    }
  };

  const handleSubmit = () => {
    if (!code.trim() || code.trim() === signature?.trim()) {
      setWarning("Please write your solution before submitting.");
      return;
    }

    setWarning('');
    setSubmitted(true);
    if (onSubmit) {
      const formattedMessage = `[CODE SUBMISSION — ${language?.toUpperCase()}]\n\n${code}`;
      onSubmit(formattedMessage);
    }
  };

  return (
    <motion.div 
      className="structured-diagram"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay }}
      style={{ 
        background: 'var(--surface-2)', 
        padding: '24px', 
        borderRadius: '16px', 
        border: '1px solid var(--border)', 
        marginTop: '16px', 
        color: 'var(--ink)' 
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ color: 'var(--ink-3)', fontSize: '0.85rem', fontWeight: '600' }}>
          Question {questionNumber} of {totalQuestions} — Coding Problem
        </div>
        <div style={{ 
          background: 'var(--surface-1)', 
          color: 'var(--ink-2)', 
          padding: '4px 10px', 
          borderRadius: '12px', 
          fontSize: '0.75rem', 
          fontWeight: '600',
          border: '1px solid var(--border)'
        }}>
          {language?.toUpperCase()}
        </div>
      </div>

      {/* Editor */}
      <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
        <CodeMirror
          value={code}
          height="280px"
          theme="dark"
          extensions={getLanguageExtension(language)}
          onChange={(value) => !submitted && setCode(value)}
          readOnly={submitted}
          style={{ fontSize: '14px', fontFamily: 'var(--font-mono, monospace)' }}
        />
      </div>

      {/* Footer / Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
        <div style={{ color: 'var(--ink-3)', fontSize: '0.8rem' }}>
          {code.length} chars
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {warning && (
            <span style={{ color: 'var(--accent-red, #ff4a4a)', fontSize: '0.85rem' }}>
              {warning}
            </span>
          )}

          {!submitted ? (
            <button
              onClick={handleSubmit}
              className="btn-primary"
              style={{ padding: '10px 20px', cursor: 'pointer' }}
            >
              Check Solution ✓
            </button>
          ) : (
            <span style={{ color: '#06D6A0', fontWeight: '600', fontSize: '0.85rem' }}>
              ✓ Submitted — Waiting for AI review...
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default InteractiveEditor;
