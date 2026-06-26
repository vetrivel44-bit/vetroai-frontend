import React, { useState, useEffect, useRef } from 'react';
import { Search, MessageSquare, Folder, Bot, FileText, CornerDownLeft } from 'lucide-react';

export default function GlobalSearch({ onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: '6vh' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 600, maxWidth: '92vw', padding: 0, overflow: 'hidden', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <Search size={20} color="var(--ink-3)" style={{ marginRight: 12 }} />
          <input 
            ref={inputRef}
            type="text" 
            value={query} 
            onChange={e => setQuery(e.target.value)} 
            placeholder="Search chats, spaces, files, or agents..." 
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '1.1rem', color: 'var(--ink)', outline: 'none' }}
          />
          <div style={{ fontSize: '0.8rem', color: 'var(--ink-3)', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ padding: '2px 6px', background: 'var(--bg-2)', borderRadius: 4, border: '1px solid var(--border)' }}>ESC</span> to close
          </div>
        </div>

        <div style={{ padding: '8px 0', maxHeight: 400, overflowY: 'auto' }}>
          {!query && (
            <div style={{ padding: '20px', color: 'var(--ink-3)', textAlign: 'center', fontSize: '0.95rem' }}>
              Start typing to search your workspace
            </div>
          )}
          {query && (
            <>
              <div style={{ padding: '8px 20px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 1 }}>Chats</div>
              <div className="search-result-item" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <MessageSquare size={16} color="var(--ink-2)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>React Optimization Techniques</div>
                  <div style={{ color: 'var(--ink-3)', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>From a chat 2 days ago in Coding Space</div>
                </div>
                <CornerDownLeft size={16} color="var(--ink-3)" />
              </div>

              <div style={{ padding: '8px 20px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 10 }}>Spaces</div>
              <div className="search-result-item" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <Folder size={16} color="var(--ink-2)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Startup Masterplan</div>
                  <div style={{ color: 'var(--ink-3)', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>3 Members • 12 Files</div>
                </div>
              </div>

              <div style={{ padding: '8px 20px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 10 }}>Artifacts</div>
              <div className="search-result-item" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <FileText size={16} color="var(--ink-2)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Q3 Financial Report.md</div>
                  <div style={{ color: 'var(--ink-3)', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Generated Document</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        .search-result-item:hover { background: var(--bg-2); }
      `}} />
    </div>
  );
}
