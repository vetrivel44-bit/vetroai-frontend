import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Code, Database, Cpu, Globe } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import '../../styles/StructuredResponse.css';

const CollapsibleDetails = ({ title, content, icon = 'code', delay = 1.0 }) => {
  const [isOpen, setIsOpen] = useState(false);

  const icons = {
    code: <Code size={16} />,
    database: <Database size={16} />,
    cpu: <Cpu size={16} />,
    globe: <Globe size={16} />
  };

  return (
    <motion.div 
      className={`structured-collapsible ${isOpen ? 'open' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay }}
    >
      <motion.div 
        className="structured-collapsible-header"
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ backgroundColor: 'var(--structured-bg)' }}
        transition={{ duration: 0.2 }}
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: isOpen ? '1px solid var(--structured-border)' : 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
          <span style={{ color: 'var(--structured-accent)' }}>{icons[icon]}</span>
          <span>{title}</span>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3 }}
          style={{ color: 'var(--structured-text-muted)' }}
        >
          <ChevronDown size={18} />
        </motion.div>
      </motion.div>
      
      <motion.div 
        className="structured-collapsible-content"
        initial={false}
        animate={{ 
          height: isOpen ? 'auto' : 0,
          opacity: isOpen ? 1 : 0
        }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        style={{ overflow: 'hidden' }}
      >
        <div style={{ padding: '4px' }}>
          <SyntaxHighlighter 
            language="javascript" 
            style={vscDarkPlus}
            customStyle={{ 
              margin: 0, 
              borderRadius: '0 0 12px 12px',
              fontSize: '0.85rem',
              background: 'transparent'
            }}
          >
            {content}
          </SyntaxHighlighter>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default CollapsibleDetails;
