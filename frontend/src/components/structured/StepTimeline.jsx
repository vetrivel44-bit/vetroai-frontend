import React from 'react';
import { motion } from 'framer-motion';
import '../../styles/StructuredResponse.css';

const StepTimeline = ({ steps, delay = 0 }) => {
  return (
    <div className="structured-timeline">
      {steps.map((step, index) => (
        <motion.div
          key={index}
          className="structured-timeline-item"
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: delay + index * 0.1 }}
        >
          <h4>{step.title}</h4>
          <p>{step.description}</p>
        </motion.div>
      ))}
    </div>
  );
};

export default StepTimeline;
