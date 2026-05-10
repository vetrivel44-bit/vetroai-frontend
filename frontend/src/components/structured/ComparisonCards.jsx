import React from 'react';
import { motion } from 'framer-motion';
import '../../styles/StructuredResponse.css';

const ComparisonCards = ({ left, right, delay = 0 }) => {
  const renderList = (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    return (
      <ul>
        {lines.map((line, i) => (
          <li key={i}>{line.replace(/^[-*•]\s*/, '')}</li>
        ))}
      </ul>
    );
  };

  return (
    <div className="structured-comparison">
      <motion.div 
        className="structured-comparison-card"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, delay: delay }}
      >
        <h3>{left.title}</h3>
        {renderList(left.description)}
      </motion.div>
      <motion.div 
        className="structured-comparison-card"
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, delay: delay + 0.2 }}
      >
        <h3>{right.title}</h3>
        {renderList(right.description)}
      </motion.div>
    </div>
  );
};

export default ComparisonCards;
