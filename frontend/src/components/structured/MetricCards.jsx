import React from 'react';
import { motion } from 'framer-motion';
import '../../styles/StructuredResponse.css';

const MetricCards = ({ metrics, delay = 0 }) => {
  return (
    <div className="structured-metrics">
      {metrics.map((metric, index) => (
        <motion.div 
          key={index}
          className="structured-metric-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: delay + index * 0.1 }}
        >
          <div className="structured-metric-value">{metric.value}</div>
          <div className="structured-metric-label">{metric.label}</div>
        </motion.div>
      ))}
    </div>
  );
};

export default MetricCards;
