import React from 'react';
import { motion } from 'framer-motion';
import { Check, X, Zap } from 'lucide-react';
import '../../styles/StructuredResponse.css';

const ComparisonTable = ({ title, options = [], features = [], delay = 0 }) => {
  if (!options || options.length === 0) return null;

  return (
    <motion.div 
      className="structured-comparison-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay }}
    >
      {title && (
        <div className="comparison-header">
          <Zap size={20} className="text-amber-500" />
          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--structured-text-primary)' }}>{title}</h2>
        </div>
      )}

      <div className="comparison-table-container">
        <table className="premium-comparison-table">
          <thead>
            <tr>
              <th>Features</th>
              {options.map((opt, i) => (
                <th key={i} className={opt.highlight ? 'highlight-col' : ''}>
                  <div className="option-header">
                    <span className="option-name">{opt.name}</span>
                    {opt.badge && <span className="option-badge">{opt.badge}</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((feature, fIdx) => (
              <tr key={fIdx}>
                <td className="feature-cell">
                  <div className="feature-label">{feature.name}</div>
                  <div className="feature-desc">{feature.description}</div>
                </td>
                {options.map((opt, oIdx) => {
                  const val = opt.features?.[feature.id] || opt.features?.[feature.name];
                  return (
                    <td key={oIdx} className={opt.highlight ? 'highlight-col' : ''}>
                      {typeof val === 'boolean' ? (
                        val ? <Check size={18} className="text-emerald-500" /> : <X size={18} className="text-rose-500" />
                      ) : (
                        <span className="feature-value-text">{val || '—'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};

export default ComparisonTable;
