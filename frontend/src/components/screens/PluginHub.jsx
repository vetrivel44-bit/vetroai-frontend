import React, { useMemo, useState } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronRight,
  Globe2,
  GraduationCap,
  Image,
  MapPinned,
  Mic,
  Plus,
  Search,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { PLUGIN_CATALOG } from "../../plugins/catalog";
import "./PluginHub.css";

const ICONS = {
  globe: Globe2,
  chart: BarChart3,
  terminal: TerminalSquare,
  image: Image,
  map: MapPinned,
  briefcase: BriefcaseBusiness,
  trophy: Trophy,
  study: GraduationCap,
  mic: Mic,
  calendar: CalendarClock,
};

function PluginIcon({ plugin, size = 22 }) {
  const Icon = ICONS[plugin.icon] || Plus;
  return (
    <span className="plugin-icon" style={{ "--plugin-color": plugin.color }}>
      <Icon size={size} />
    </span>
  );
}

export default function PluginHub({ pluginState, onInstall, onToggle, onUninstall, onClose }) {
  const [tab, setTab] = useState("explore");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  const installedCount = PLUGIN_CATALOG.filter((plugin) => pluginState[plugin.id]?.installed).length;
  const visiblePlugins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return PLUGIN_CATALOG.filter((plugin) => {
      if (tab === "installed" && !pluginState[plugin.id]?.installed) return false;
      if (!normalizedQuery) return true;
      return [plugin.name, plugin.tagline, plugin.description, plugin.category]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [pluginState, query, tab]);

  const selectedStatus = selected ? pluginState[selected.id] || {} : {};

  return (
    <div className="plugin-overlay" role="dialog" aria-modal="true" aria-label="VetroAI plugins">
      <div className="plugin-shell">
        <header className="plugin-header">
          <div>
            <div className="plugin-eyebrow">VetroAI extensions</div>
            <h2>Plugins</h2>
            <p>Add focused capabilities to your conversations.</p>
          </div>
          <button className="plugin-close" onClick={onClose} aria-label="Close plugins"><X size={20} /></button>
        </header>

        <div className="plugin-controls">
          <div className="plugin-tabs" role="tablist">
            <button className={tab === "explore" ? "active" : ""} onClick={() => setTab("explore")}>Explore</button>
            <button className={tab === "installed" ? "active" : ""} onClick={() => setTab("installed")}>
              Installed <span>{installedCount}</span>
            </button>
          </div>
          <label className="plugin-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins" autoFocus />
          </label>
        </div>

        <main className="plugin-body">
          {tab === "explore" && !query && (
            <section className="plugin-featured">
              <div>
                <span className="plugin-featured-label">Featured</span>
                <h3>Build your own VetroAI</h3>
                <p>Install only the tools you want. Mention an installed plugin with <strong>@Plugin name</strong> to use it for one message.</p>
              </div>
              <div className="plugin-featured-icons">
                {PLUGIN_CATALOG.filter((plugin) => plugin.featured).map((plugin) => <PluginIcon key={plugin.id} plugin={plugin} />)}
              </div>
            </section>
          )}

          <div className="plugin-section-title">
            <div>
              <h3>{tab === "installed" ? "Your plugins" : query ? "Search results" : "Plugin directory"}</h3>
              <p>{visiblePlugins.length} {visiblePlugins.length === 1 ? "plugin" : "plugins"}</p>
            </div>
          </div>

          {visiblePlugins.length > 0 ? (
            <div className="plugin-grid">
              {visiblePlugins.map((plugin) => {
                const status = pluginState[plugin.id] || {};
                return (
                  <article className="plugin-card" key={plugin.id}>
                    <button className="plugin-card-main" onClick={() => setSelected(plugin)}>
                      <PluginIcon plugin={plugin} />
                      <span className="plugin-card-copy">
                        <span className="plugin-card-topline"><strong>{plugin.name}</strong><small>{plugin.category}</small></span>
                        <span className="plugin-card-tagline">{plugin.tagline}</span>
                        <span className="plugin-card-description">{plugin.description}</span>
                      </span>
                      <ChevronRight size={17} className="plugin-card-chevron" />
                    </button>
                    <footer className="plugin-card-footer">
                      {status.installed ? (
                        <>
                          <label className="plugin-toggle">
                            <input type="checkbox" checked={status.enabled !== false} onChange={() => onToggle(plugin.id)} />
                            <span />
                            {status.enabled !== false ? "Enabled" : "Disabled"}
                          </label>
                          <button className="plugin-text-button danger" onClick={() => onUninstall(plugin.id)}><Trash2 size={14} /> Remove</button>
                        </>
                      ) : (
                        <button className="plugin-install" onClick={() => onInstall(plugin.id)}><Plus size={15} /> Install</button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="plugin-empty">
              <Search size={26} />
              <h3>{tab === "installed" ? "No plugins installed" : "No plugins found"}</h3>
              <p>{tab === "installed" ? "Explore the directory and install the capabilities you need." : "Try a different search term."}</p>
              {tab === "installed" && <button onClick={() => setTab("explore")}>Explore plugins</button>}
            </div>
          )}
        </main>
      </div>

      {selected && (
        <div className="plugin-detail-backdrop" onClick={() => setSelected(null)}>
          <aside className="plugin-detail" onClick={(event) => event.stopPropagation()}>
            <button className="plugin-close" onClick={() => setSelected(null)} aria-label="Close plugin details"><X size={19} /></button>
            <PluginIcon plugin={selected} size={28} />
            <span className="plugin-detail-category">{selected.category}</span>
            <h3>{selected.name}</h3>
            <p className="plugin-detail-tagline">{selected.tagline}</p>
            <p>{selected.description}</p>
            <div className="plugin-permissions">
              <h4><ShieldCheck size={16} /> Permissions</h4>
              {selected.permissions.map((permission) => <div key={permission}><Check size={14} /> {permission}</div>)}
            </div>
            <div className="plugin-invoke-tip"><strong>Try it:</strong> Type <code>@{selected.name}</code> in your prompt.</div>
            {selectedStatus.installed ? (
              <div className="plugin-detail-actions">
                <button className="plugin-install secondary" onClick={() => onToggle(selected.id)}>{selectedStatus.enabled !== false ? "Disable" : "Enable"}</button>
                <button className="plugin-text-button danger" onClick={() => { onUninstall(selected.id); setSelected(null); }}><Trash2 size={15} /> Uninstall</button>
              </div>
            ) : (
              <button className="plugin-install wide" onClick={() => onInstall(selected.id)}><Plus size={16} /> Install plugin</button>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

