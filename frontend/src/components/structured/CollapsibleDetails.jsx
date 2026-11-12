import { motion } from 'framer-motion';
import { ChevronDown, Code, Database, Cpu, Globe } from 'lucide-react';
import React, { useState, Suspense } from 'react';

// Prism's grammars load with the first code block rather than with the app.
const CodeHighlighter = React.lazy(() => import('../CodeHighlighter'));
import '../../styles/StructuredResponse.css';

// The language the model named, else a guess from the text: it was always
// highlighted as JavaScript, so SQL, shell and logs came out in odd colors.
export function guessLanguage(content = '', named = '') {
  if (named) return named;
  const text = String(content);
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH|ALTER)\b/im.test(text)) return 'sql';
  if (/^\s*[{[]/.test(text) && /"\s*:/.test(text)) return 'json';
  if (/^\s*(def |import |from \S+ import |class \w+[:(])/m.test(text)) return 'python';
  if (/^\s*(\$ |sudo |npm |pip |git |curl |docker |kubectl |cd |ls |export )/m.test(text)) return 'bash';
  if (/^\s*(server|location|upstream)\s+[^{]*\{/m.test(text)) return 'nginx';
  if (/^\s*[\w.-]+:\s/m.test(text) && !/[;{}]/.test(text)) return 'yaml';
  if (/(const |let |function |=>|console\.)/.test(text)) return 'javascript';
  return 'clike';
}

const CollapsibleDetails = ({ title, content, icon = 'code', language = '', delay = 1.0 }) => {
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
          <Suspense fallback={<pre style={{ margin: 0, fontSize: '0.85rem', background: 'transparent', whiteSpace: 'pre-wrap' }}>{content}</pre>}>
            <CodeHighlighter
              language={guessLanguage(content, language)}
              followTheme
              codeTagProps={{ style: { background: 'transparent', display: 'block' } }}
              customStyle={{
                margin: 0,
                borderRadius: '0 0 12px 12px',
                fontSize: '0.85rem',
                background: 'transparent'
              }}
            >
              {content}
            </CodeHighlighter>
          </Suspense>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default CollapsibleDetails;
