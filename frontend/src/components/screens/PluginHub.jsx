import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, Plus, Search, ShieldCheck, Trash2, X, Zap, PlugZap, Terminal, Sparkles, Radio } from "lucide-react";
import { PLUGIN_CATALOG, PLUGIN_CATEGORIES, searchPlugins, installedCount } from "../../plugins/catalog";
import PluginIcon from "../../plugins/PluginIcon";
import "./PluginHub.css";

// What "Check live data" starts with for each live source.
const LIVE_EXAMPLES = {
  sports: "India cricket score",
  weather: "weather in Chennai",
  news: "top news India",
  markets: "bitcoin price",
  currency: "100 USD to INR",
};

/**
 * The Plugins page: search the catalog, filter by category, open a plugin to
 * see its skills, commands and connectors, and install, turn on/off or
 * remove it. `apiBase` is the backend, asked which live-data connectors have
 * their keys set (GET /plugins/status).
 */
export default function PluginHub({ pluginState, onInstall, onToggle, onUninstall, onClose, apiBase }) {
  const [tab, setTab] = useState("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [connectorStatus, setConnectorStatus] = useState(null);
  // "Check live data" on a live plugin's page.
  const [liveQuery, setLiveQuery] = useState("");
  const [liveCheck, setLiveCheck] = useState(null);

  useEffect(() => {
    if (!apiBase) return undefined;
    const ctrl = new AbortController();
    fetch(`${apiBase}/plugins/status`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (body?.connectors) setConnectorStatus(body.connectors); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [apiBase]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (selectedId) setSelectedId(null);
      else onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onClose]);

  const installed = installedCount(pluginState);
  const inTab = (plugin) => tab !== "installed" || pluginState[plugin.id]?.installed;
  const inCategory = (plugin) => category === "All" || plugin.category === category;

  // A search ranks the whole catalog (plugins/catalog.js); otherwise catalog order.
  const visiblePlugins = useMemo(() => {
    const q = query.trim();
    const base = q
      ? (() => { const { installed: mine, available } = searchPlugins(q, pluginState, { limit: 100 }); return [...mine, ...available]; })()
      : PLUGIN_CATALOG;
    return base.filter((plugin) => inTab(plugin) && inCategory(plugin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginState, query, tab, category]);

  const counts = useMemo(() => {
    const c = { All: 0 };
    for (const plugin of PLUGIN_CATALOG) {
      if (!inTab(plugin)) continue;
      c.All++;
      c[plugin.category] = (c[plugin.category] || 0) + 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginState, tab]);

  const selected = selectedId ? PLUGIN_CATALOG.find((p) => p.id === selectedId) : null;

  useEffect(() => {
    setLiveCheck(null);
    setLiveQuery(selected?.live ? LIVE_EXAMPLES[selected.live] || "" : "");
  }, [selected?.id, selected?.live]);

  const runLiveCheck = async (event) => {
    event?.preventDefault();
    if (!selected?.live || !apiBase || !liveQuery.trim()) return;
    setLiveCheck({ loading: true });
    try {
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
      const res = await fetch(`${apiBase}/plugins/live/${selected.live}?q=${encodeURIComponent(liveQuery.trim())}&tz=${encodeURIComponent(tz)}`);
      const body = await res.json().catch(() => ({}));
      setLiveCheck(body.error ? { error: body.error } : body);
    } catch {
      setLiveCheck({ error: "Couldn't reach the server." });
    }
  };
  const status = (id) => pluginState[id] || {};

  const actions = (plugin, wide = false) => {
    const s = status(plugin.id);
    if (!s.installed) {
      return (
        <button type="button" className={`plugin-install${wide ? " wide" : ""}`} onClick={() => onInstall(plugin.id)}>
          <Plus size={15} /> Install
        </button>
      );
    }
    return (
      <div className="plugin-card-controls">
        <label className="plugin-toggle" title={s.enabled !== false ? "Turn off" : "Turn on"}>
          <input type="checkbox" checked={s.enabled !== false} onChange={() => onToggle(plugin.id)} aria-label={`${plugin.name} on`} />
          <span />
          {s.enabled !== false ? "On" : "Off"}
        </label>
        <button type="button" className="plugin-text-button danger" onClick={() => onUninstall(plugin.id)} aria-label={`Uninstall ${plugin.name}`}>
          <Trash2 size={14} /> {wide ? "Uninstall" : ""}
        </button>
      </div>
    );
  };

  const connectorLine = (connector) => {
    let state;
    if (connector.keyless) state = { tone: "ok", text: "No key needed" };
    else if (connector.env && connectorStatus && connector.id in connectorStatus) {
      state = connectorStatus[connector.id]
        ? { tone: "ok", text: "Connected" }
        : { tone: connector.optional ? "info" : "warn", text: connector.optional ? `Optional · set ${connector.env}` : `Not connected · set ${connector.env}` };
    } else if (connector.env) state = { tone: "info", text: `Needs ${connector.env} on the server` };
    else state = { tone: "info", text: connector.note || "Not connected" };
    return (
      <li key={connector.id}>
        <PlugZap size={15} />
        <span className="plugin-connector-name">{connector.name}</span>
        <span className={`plugin-connector-state is-${state.tone}`}>{state.text}</span>
        {connector.note && connector.env && <small>{connector.note}</small>}
      </li>
    );
  };

  return (
    <div className="plugin-overlay" role="dialog" aria-modal="true" aria-label="Plugins" onClick={onClose}>
      <div className="plugin-shell" onClick={(event) => event.stopPropagation()}>
        {selected ? (
          <div className="plugin-detail-page">
            <header className="plugin-detail-head">
              <button type="button" className="plugin-back" onClick={() => setSelectedId(null)}><ChevronLeft size={18} /> Plugins</button>
              <button type="button" className="plugin-close" onClick={onClose} aria-label="Close plugins"><X size={20} /></button>
            </header>
            <main className="plugin-detail-body">
              <div className="plugin-detail-hero">
                <PluginIcon plugin={selected} size={28} className="plugin-icon is-large" />
                <div>
                  <span className="plugin-detail-category">{selected.category}{selected.live ? " · Live data" : ""}</span>
                  <h2>{selected.name}</h2>
                  <p className="plugin-detail-tagline">{selected.tagline}</p>
                </div>
                <div className="plugin-detail-actions">{actions(selected, true)}</div>
              </div>
              <p className="plugin-detail-desc">{selected.description}</p>

              <section className="plugin-detail-section">
                <h3><Sparkles size={16} /> Skills</h3>
                <ul className="plugin-skill-list">
                  {selected.skills.map((skill) => (
                    <li key={skill.id}>
                      <strong>{skill.name}</strong>
                      <span>{skill.description}</span>
                      <details>
                        <summary>What VetroAI is told</summary>
                        <p>{skill.instructions}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>

              {selected.commands?.length > 0 && (
                <section className="plugin-detail-section">
                  <h3><Terminal size={16} /> Commands</h3>
                  <ul className="plugin-command-list">
                    {selected.commands.map((cmd) => (
                      <li key={cmd.name}><code>/{cmd.name}</code><span>{cmd.description}</span></li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="plugin-detail-section">
                <h3><PlugZap size={16} /> Connectors</h3>
                {selected.connectors?.length
                  ? <ul className="plugin-connector-list">{selected.connectors.map(connectorLine)}</ul>
                  : <p className="plugin-muted">None: works with what you type or attach.</p>}
              </section>

              {selected.live && (
                <section className="plugin-detail-section">
                  <h3><Radio size={16} /> Check live data</h3>
                  <form className="plugin-live-check" onSubmit={runLiveCheck}>
                    <input value={liveQuery} onChange={(event) => setLiveQuery(event.target.value)} aria-label="Ask for live data" placeholder="e.g. weather in Chennai" />
                    <button type="submit" disabled={liveCheck?.loading || !liveQuery.trim()}>{liveCheck?.loading ? "Checking…" : "Check"}</button>
                  </form>
                  {liveCheck && !liveCheck.loading && (
                    <div className={`plugin-live-result${liveCheck.connected === false || liveCheck.error ? " is-warn" : ""}`} role="status">
                      {liveCheck.connected === false ? <p>{liveCheck.notice}.</p>
                        : liveCheck.error ? <p>Live data couldn't be fetched: {liveCheck.error}</p>
                        : (
                          <>
                            <ul>{(liveCheck.lines || []).map((line, i) => <li key={i}>{line.replace(/^- /, "")}</li>)}</ul>
                            <small>{liveCheck.source} · fetched {liveCheck.fetchedAt}</small>
                          </>
                        )}
                    </div>
                  )}
                </section>
              )}

              {selected.permissions?.length > 0 && (
                <section className="plugin-detail-section">
                  <h3><ShieldCheck size={16} /> Permissions</h3>
                  <ul className="plugin-permission-list">
                    {selected.permissions.map((permission) => <li key={permission}><Check size={14} /> {permission}</li>)}
                  </ul>
                </section>
              )}

              <div className="plugin-invoke-tip">
                <Zap size={15} />
                <span>Type <code>@{selected.name}</code> in a message to use it{selected.commands?.[0] ? <>, or <code>/{selected.commands[0].name}</code></> : null}. Once installed, it also switches on by itself for messages it fits.</span>
              </div>
            </main>
          </div>
        ) : (
          <>
            <header className="plugin-header">
              <div>
                <h2>Plugins</h2>
                <p>Skills, commands and live data for your chats. Mention one with @, or type / for its commands.</p>
              </div>
              <button type="button" className="plugin-close" onClick={onClose} aria-label="Close plugins"><X size={20} /></button>
            </header>

            <div className="plugin-controls">
              <div className="plugin-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "explore"} className={tab === "explore" ? "active" : ""} onClick={() => setTab("explore")}>Explore</button>
                <button type="button" role="tab" aria-selected={tab === "installed"} className={tab === "installed" ? "active" : ""} onClick={() => setTab("installed")}>
                  Installed <span>{installed}</span>
                </button>
              </div>
              <label className="plugin-search">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins, skills, keywords…" autoFocus aria-label="Search plugins" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
              </label>
            </div>

            <div className="plugin-categories" role="toolbar" aria-label="Categories">
              {["All", ...PLUGIN_CATEGORIES].filter((c) => c === "All" || counts[c]).map((c) => (
                <button type="button" key={c} className={category === c ? "active" : ""} aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {c} <span>{counts[c] || 0}</span>
                </button>
              ))}
            </div>

            <main className="plugin-body">
              {visiblePlugins.length > 0 ? (
                <div className="plugin-grid">
                  {visiblePlugins.map((plugin) => (
                    <article className={`plugin-card${status(plugin.id).installed ? " is-installed" : ""}`} key={plugin.id}>
                      <button type="button" className="plugin-card-main" onClick={() => setSelectedId(plugin.id)}>
                        <PluginIcon plugin={plugin} />
                        <span className="plugin-card-copy">
                          <span className="plugin-card-topline">
                            <strong>{plugin.name}</strong>
                            {plugin.live && <em className="plugin-live-badge">Live</em>}
                          </span>
                          <span className="plugin-card-tagline">{plugin.tagline}</span>
                          <span className="plugin-card-meta">{plugin.category} · {plugin.skills.length} skill{plugin.skills.length === 1 ? "" : "s"}{plugin.commands?.length ? ` · ${plugin.commands.length} command${plugin.commands.length === 1 ? "" : "s"}` : ""}</span>
                        </span>
                      </button>
                      <footer className="plugin-card-footer">{actions(plugin)}</footer>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="plugin-empty">
                  <Search size={26} />
                  <h3>{tab === "installed" && !query ? "No plugins installed" : "No plugins match"}</h3>
                  <p>{tab === "installed" && !query ? "Explore the catalog and install what you need." : "Try another word, or a different category."}</p>
                  {(tab === "installed" || category !== "All") && (
                    <button type="button" onClick={() => { setTab("explore"); setCategory("All"); }}>Browse all plugins</button>
                  )}
                </div>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
