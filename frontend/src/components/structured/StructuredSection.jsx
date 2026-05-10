import React from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import '../../styles/StructuredResponse.css';

const StructuredSection = ({ title, content, children, delay = 0 }) => {
  return (
    <motion.div 
      className="structured-section"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay }}
    >
      {title && <h2>{title}</h2>}
      <div className="section-body">
        {content ? (
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, inline, className, children, ...rest }) {
                const match = /language-(\w+)/.exec(className || '');
                return !inline && match ? (
                  <div className="code-block">
                    <div className="code-header">
                      <span>{match[1]}</span>
                      <button onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))} className="copy-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      </button>
                    </div>
                    <SyntaxHighlighter 
                      style={vscDarkPlus} 
                      language={match[1]} 
                      PreTag="div" 
                      className="syntax-highlighter"
                      customStyle={{ background: 'transparent', padding: 0 }}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  </div>
                ) : (
                  <code className={className} {...rest}>{children}</code>
                );
              }
            }}
          >
            {content}
          </ReactMarkdown>
        ) : children}
      </div>
    </motion.div>
  );
};

export default StructuredSection;
