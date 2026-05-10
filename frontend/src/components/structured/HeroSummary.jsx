import React from 'react';
import { motion } from 'framer-motion';
import '../../styles/StructuredResponse.css';

const HeroSummary = ({ title, tagline, badge, delay = 0 }) => {
  return (
    <motion.div 
      className="structured-hero"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ 
        duration: 0.8, 
        delay,
        ease: [0.16, 1, 0.3, 1]
      }}
    >
      {badge && (
        <motion.span 
          className="label"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.3 }}
        >
          {badge}
        </motion.span>
      )}
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: delay + 0.1 }}
      >
        {title}
      </motion.h1>
      {tagline && (
        <motion.p 
          className="tagline"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: delay + 0.4 }}
        >
          {tagline}
        </motion.p>
      )}
    </motion.div>
  );
};

export default HeroSummary;
