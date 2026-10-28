import React from 'react';
import { motion } from 'framer-motion';
import { Check, X, Zap } from 'lucide-react';
import '../../styles/StructuredResponse.css';

// A model writes the feature keys by hand, so "Identity", "identity" and
// "identity " have to find the same value — a near miss used to show "—".
const keyOf = (k) => String(k ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const valueFor = (option, feature) => {
  const values = option?.features || {};
  for (const k of [feature.id, feature.name]) if (k != null && k in values) return values[k];
  const wanted = new Set([keyOf(feature.id), keyOf(feature.name)].filter(Boolean));
  const hit = Object.keys(values).find((k) => wanted.has(keyOf(k)));
  return hit === undefined ? undefined : values[hit];
};

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
          <Zap size={20} style={{ color: 'var(--structured-accent)' }} />
          <h2 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--structured-text-primary)' }}>{title}</h2>
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
                  const val = valueFor(opt, feature);
                  // data-label names the option when a phone stacks the row (StructuredResponse.css).
                  return (
                    <td key={oIdx} className={opt.highlight ? 'highlight-col' : ''} data-label={opt.name}>
                      {typeof val === 'boolean' ? (
                        val ? <Check size={18} style={{ color: 'var(--s-success)' }} /> : <X size={18} style={{ color: 'var(--s-danger)' }} />
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
