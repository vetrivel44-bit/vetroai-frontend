import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import '../../styles/StructuredResponse.css';

const HighlightAlert = ({ type = 'info', children, delay = 0 }) => {
  const icons = {
    success: <CheckCircle size={20} />,
    warning: <AlertTriangle size={20} />,
    danger: <AlertCircle size={20} />,
    info: <Info size={20} />
  };

  return (
    <motion.div 
      className={`structured-alert ${type}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay }}
    >
      <div className="structured-alert-icon">
        {icons[type]}
      </div>
      <div className="structured-alert-content">
        {children}
      </div>
    </motion.div>
  );
};

export default HighlightAlert;
