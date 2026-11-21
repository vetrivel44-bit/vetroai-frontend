import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import PluginIcon from "../../plugins/PluginIcon";

/**
 * The menu above the composer while typing "@…" (plugins) or "/…" (the
 * commands of installed plugins). Rows come from plugins/catalog.js's
 * searchPlugins / searchCommands; App.jsx owns the keyboard (↑ ↓ to move,
 * Enter or Tab to pick, Esc to close) and passes the active row in.
 *
 * rows: [{ type: "plugin", plugin, installed, enabled } | { type: "command", plugin, command }]
 */
export default function ComposerMenu({ kind, query, rows, activeIndex, onPick, onHover, onBrowse }) {
  const listRef = useRef(null);
  const menuRef = useRef(null);
  // Where the menu fits: above the box when there's room, else below it (the
  // box sits mid-screen on the start page), never under the top bar or off
  // the bottom; the list scrolls inside whatever height that leaves.
  const [place, setPlace] = useState({ below: false, maxList: 340 });
  useLayoutEffect(() => {
    const measure = () => {
      const box = menuRef.current?.parentElement?.getBoundingClientRect();
      if (!box) return;
      const header = document.querySelector(".chat-header")?.getBoundingClientRect();
      const top = Math.max(header?.bottom || 0, 0) + 8;
      const above = box.top - 8 - top;
      const below = window.innerHeight - box.bottom - 16;
      const chrome = 52; // the "Browse all plugins" row and padding
      const wanted = Math.min(340, (listRef.current?.scrollHeight || 340));
      const goBelow = above < wanted + chrome && below > above;
      const room = (goBelow ? below : above) - chrome;
      setPlace({ below: goBelow, maxList: Math.max(120, Math.min(340, room)) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [rows.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const row = (item, index) => {
    const active = index === activeIndex;
    const common = {
      key: item.type === "command" ? `${item.plugin.id}/${item.command.name}` : item.plugin.id,
      id: `vc-menu-row-${index}`,
      "data-index": index,
      role: "option",
      "aria-selected": active,
      className: `vc-menu-row${active ? " is-active" : ""}`,
      onMouseDown: (event) => event.preventDefault(),
      onMouseEnter: () => onHover(index),
      onClick: () => onPick(item),
    };
    if (item.type === "command") {
      return (
        <div {...common}>
          <PluginIcon plugin={item.plugin} size={15} className="vc-menu-icon" />
          <span className="vc-menu-text">
            <strong>/{item.command.name}</strong>
            <small>{item.command.description}</small>
          </span>
          <span className="vc-menu-meta">{item.plugin.name}</span>
        </div>
      );
    }
    return (
      <div {...common}>
        <PluginIcon plugin={item.plugin} size={15} className="vc-menu-icon" />
        <span className="vc-menu-text">
          <strong>{item.plugin.name}</strong>
          <small>{item.plugin.tagline}</small>
        </span>
        {item.installed
          ? <span className="vc-menu-meta">{item.enabled ? item.plugin.category : "Off · tap to turn on"}</span>
          : (
            <button type="button" className="vc-menu-install" tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => { event.stopPropagation(); onPick(item); }}
              aria-label={`Install ${item.plugin.name}`}>
              Install
            </button>
          )}
      </div>
    );
  };

  const installed = rows.filter((r) => r.type === "plugin" && r.installed);
  const available = rows.filter((r) => r.type === "plugin" && !r.installed);
  const label = kind === "slash" ? "Commands" : "Plugins";

  return (
    <div ref={menuRef} className={`vc-menu${place.below ? " is-below" : ""}`} role="listbox" id="vc-composer-menu" aria-label={label}
      aria-activedescendant={rows.length ? `vc-menu-row-${activeIndex}` : undefined}>
      <div className="vc-menu-scroll" ref={listRef} style={{ maxHeight: place.maxList }}>
        {kind === "slash" ? (
          rows.length ? (
            <>
              <div className="vc-menu-group">Commands</div>
              {rows.map(row)}
            </>
          ) : (
            <div className="vc-menu-empty">
              {query ? <>No command matches “/{query}”.</> : <>No commands yet. Plugins you install add their / commands here.</>}
            </div>
          )
        ) : rows.length ? (
          <>
            {installed.length > 0 && <div className="vc-menu-group">Installed</div>}
            {installed.map((item) => row(item, rows.indexOf(item)))}
            {available.length > 0 && <div className="vc-menu-group">Available</div>}
            {available.map((item) => row(item, rows.indexOf(item)))}
          </>
        ) : (
          <div className="vc-menu-empty">No plugins match “{query}”.</div>
        )}
      </div>
      <button type="button" className="vc-menu-browse" onMouseDown={(event) => event.preventDefault()} onClick={onBrowse}>
        Browse all plugins
      </button>
    </div>
  );
}
