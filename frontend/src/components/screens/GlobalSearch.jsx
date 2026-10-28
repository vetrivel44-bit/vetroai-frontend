import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, MessageSquare, Folder, FileText, CornerDownLeft } from 'lucide-react';
import { searchWorkspace, ago } from '../../lib/workspaceSearch';

// Wraps each typed word in <mark> so results show why they matched.
function Highlight({ text, terms }) {
  if (!text || !terms.length) return text || null;
  const rx = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return String(text).split(rx).map((part, i) => (i % 2 ? <mark key={i} className="gs-mark">{part}</mark> : part));
}

// The sidebar's search: chats, projects and artifacts (lib/workspaceSearch.js).
// ↑/↓ move through results, Enter opens one, Esc closes.
export default function GlobalSearch({ sessions = [], spaces = [], artifacts = [], onOpenChat, onOpenSpace, onOpenArtifact, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const groups = useMemo(() => {
    if (!terms.length) {
      // Before typing: the most recent chats.
      const recent = [...sessions]
        .sort((a, b) => (Number(String(b.id).split('_')[0]) || 0) - (Number(String(a.id).split('_')[0]) || 0))
        .slice(0, 6)
        .map((s) => ({ kind: 'chat', id: s.id, title: s.title || 'Untitled', detail: ago(Number(String(s.id).split('_')[0])) }));
      return recent.length ? [{ label: 'Recent chats', items: recent }] : [];
    }
    const r = searchWorkspace({ query, sessions, spaces, artifacts });
    return [
      { label: 'Chats', items: r.chats.map((c) => ({ kind: 'chat', id: c.id, title: c.title, detail: c.snippet || ago(c.time) })) },
      { label: 'Projects', items: r.spaces.map((s) => ({ kind: 'space', id: s.id, title: s.title, detail: s.detail })) },
      { label: 'Artifacts', items: r.artifacts.map((a) => ({ kind: 'artifact', id: a.id, title: a.title, detail: a.detail, artifact: a.artifact })) },
    ].filter((g) => g.items.length);
  }, [query, terms, sessions, spaces, artifacts]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = (item) => {
    if (!item) return;
    if (item.kind === 'chat') onOpenChat?.(item.id);
    else if (item.kind === 'space') onOpenSpace?.(item.id);
    else if (item.kind === 'artifact') onOpenArtifact?.(item.artifact);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); open(flat[active]); }
  };

  const ICON = { chat: MessageSquare, space: Folder, artifact: FileText };
  let index = -1;

  return (
    <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: '8vh' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal gs-modal" role="dialog" aria-label="Search" onKeyDown={onKeyDown}>
        <div className="gs-bar">
          <Search size={19} color="var(--ink-3)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search chats, projects and artifacts…"
            aria-label="Search"
          />
          <kbd className="gs-kbd">Esc</kbd>
        </div>

        <div className="gs-list" ref={listRef}>
          {terms.length > 0 && !flat.length && (
            <div className="gs-empty">No results for “{query.trim()}”</div>
          )}
          {!terms.length && !flat.length && (
            <div className="gs-empty">Start typing to search your chats, projects and artifacts</div>
          )}
          {groups.map((g) => (
            <div key={g.label} className="gs-group">
              <div className="gs-label">{g.label}</div>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const Icon = ICON[item.kind];
                return (
                  <button
                    type="button"
                    key={`${item.kind}-${item.id}`}
                    className={`gs-item${i === active ? ' on' : ''}`}
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => open(item)}
                  >
                    <Icon size={16} className="gs-icon" />
                    <span className="gs-text">
                      <span className="gs-title"><Highlight text={item.title} terms={terms} /></span>
                      {item.detail && <span className="gs-detail"><Highlight text={item.detail} terms={terms} /></span>}
                    </span>
                    {i === active && <CornerDownLeft size={15} className="gs-enter" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .gs-modal { width: 620px; max-width: 92vw; padding: 0; overflow: hidden; box-sizing: border-box; }
        .gs-bar { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
        .gs-bar input { flex: 1; min-width: 0; border: none; background: transparent; font-size: 1.05rem; color: var(--ink); outline: none; }
        .gs-kbd { font: inherit; font-size: 0.72rem; color: var(--ink-3); padding: 2px 7px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg-2, var(--bg)); }
        .gs-list { max-height: min(440px, 62vh); overflow-y: auto; padding: 6px 0 8px; }
        .gs-empty { padding: 26px 20px; text-align: center; color: var(--ink-3); font-size: 0.92rem; }
        .gs-group + .gs-group { margin-top: 6px; }
        .gs-label { padding: 8px 20px 4px; font-size: 0.72rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
        .gs-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 20px; border: 0; background: none; text-align: left; cursor: pointer; color: inherit; font: inherit; }
        .gs-item.on { background: var(--bg-hover); }
        .gs-icon { flex-shrink: 0; color: var(--ink-3); }
        .gs-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .gs-title { color: var(--ink); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gs-detail { color: var(--ink-3); font-size: 0.84rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gs-enter { flex-shrink: 0; color: var(--ink-3); }
        .gs-mark { background: var(--accent-mid, rgba(250, 200, 0, .35)); color: inherit; border-radius: 3px; padding: 0 1px; }
      ` }} />
    </div>
  );
}
