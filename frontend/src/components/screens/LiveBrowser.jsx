import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Loader2, Lock, RotateCw, Search } from "lucide-react";
import SourceFavicon from "../SourceFavicon";
import { browserActions, screenshotUrls } from "../../lib/browserReplay";
import { browseSummary, citationNumbers, isFinal, outcomeText, wasRead } from "../../lib/browseLog";
import "./LiveBrowser.css";

// A small browser window showing VetroAI's web work.
//
// With `log` (VetroAI Computer, lib/browseLog.js) it shows what the backend
// really did, as it reports it: the search, then each page it opened. A page
// stays on screen as "opening" until it has really been read, then shows the
// text that was read from it — or that the site blocked the visit or failed
// to load, and that nothing from it is used. Afterwards it lists every page
// with the number the answer cites it by.
//
// Without a log (DeepSearch's activity, older tasks) it replays the run's
// real searches and sources: the cursor goes to the search box and types each
// search, opens a result, and each page's screenshot scrolls as it reads.
export default function LiveBrowser({ log, running, ...props }) {
  if (log) return <BrowseLogView log={log} running={running ?? props.live} />;
  return <ReplayBrowser {...props} />;
}

// ─── the real log ────────────────────────────────────────────────────────────
// How long a step stays on screen once its outcome is known, so the steps can
// be followed even when several pages finished at once.
const DWELL_MS = { search: 1100, read: 2400, other: 1700 };

function BrowseLogView({ log, running }) {
  const entries = log;
  const summary = browseSummary(entries);
  const numbers = citationNumbers(entries);
  // The step on screen; null shows the list of pages. A run opened later
  // starts at the list, and Replay steps through it again.
  const [step, setStep] = useState(() => (running ? 0 : null));
  const shownAt = useRef(0);
  const current = step === null || !entries.length ? null : entries[Math.min(step, entries.length - 1)];

  // When the step on screen last changed: it appeared, or its outcome came in
  // (a page that loaded slowly is still shown read, for as long as any other).
  // Declared first, so it runs before the effect below.
  const status = current?.status;
  useEffect(() => { shownAt.current = Date.now(); }, [step, status]);

  // Moves on only once the step on screen has its real outcome and has been
  // seen for a moment. A page still loading stays on screen, loading. After
  // the last step: wait while the browsing goes on, then show the list.
  useEffect(() => {
    if (!current || !isFinal(current)) return undefined;
    const last = step >= entries.length - 1;
    if (last && running) return undefined;
    const dwell = current.kind === "search" ? DWELL_MS.search : wasRead(current) ? DWELL_MS.read : DWELL_MS.other;
    const timer = setTimeout(() => setStep(last ? null : step + 1), Math.max(0, dwell - (Date.now() - shownAt.current)));
    return () => clearTimeout(timer);
  }, [step, current, entries.length, running]);

  const replay = () => setStep(0);
  const loading = current?.status === "loading" || current?.status === "searching";
  const searchUrl = (e) => `vetroai.app/search?q=${encodeURIComponent(e?.query || "")}`;
  const url = current?.kind === "visit" ? current.url : searchUrl(current || entries.find((e) => e.kind === "search"));
  return (
    <div className={`lb lb-log${running ? " is-live" : ""}`} aria-label="VetroAI's browser">
      <BrowserBar url={url} live={running} loading={loading} />
      <div className="lb-body">
        {!current && <ReadList entries={entries} numbers={numbers} />}
        {current?.kind === "search" && <SearchStep entry={current} />}
        {current?.kind === "visit" && <PageStep key={current.id} entry={current} number={numbers.get(current.id)} />}
      </div>
      <div className="lb-foot">
        <span className={`lb-dot${running ? " is-live" : ""}`} />
        <span className="lb-foot-text">{current ? outcomeText(current) : summaryLine(summary, running)}</span>
        {!current && !running && entries.length > 0 && <button type="button" onClick={replay}><RotateCw size={12} /> Replay</button>}
      </div>
    </div>
  );
}

function summaryLine(s, running) {
  const parts = [`${s.searches} search${s.searches === 1 ? "" : "es"}`, `${s.read + s.partial} page${s.read + s.partial === 1 ? "" : "s"} read`];
  if (s.blocked) parts.push(`${s.blocked} blocked`);
  if (s.failed) parts.push(`${s.failed} couldn't open`);
  if (s.loading) parts.push(`${s.loading} opening`);
  return running ? `${parts.join(" · ")} — writing the answer from what was read` : parts.join(" · ");
}

function SearchStep({ entry }) {
  return (
    <div className="lb-search">
      <div className="lb-logo">Vetro<span>AI</span> Search</div>
      <div className="lb-box">
        <Search size={14} />
        <span className="lb-typed">{entry.query}</span>
        <span className="lb-go">Search</span>
      </div>
      <div className="lb-search-status">
        {entry.status === "done"
          ? `${entry.found ?? 0} ${entry.found === 1 ? "result" : "results"} — opening the top ones`
          : <><Loader2 size={13} className="lb-spin" /> Searching…</>}
      </div>
    </div>
  );
}

function PageStep({ entry, number }) {
  const head = (
    <div className="lb-reader-head">
      <SourceFavicon domain={entry.domain} />
      <div className="lb-reader-title">
        <strong>{entry.title || entry.domain}</strong>
        <span>{entry.domain}</span>
      </div>
      {entry.status === "read" && <span className="lb-chip is-read">Read{number ? ` · [${number}]` : ""}</span>}
      {entry.status === "partial" && <span className="lb-chip is-partial">Partly read{number ? ` · [${number}]` : ""}</span>}
      {entry.status === "blocked" && <span className="lb-chip is-blocked">Blocked</span>}
      {entry.status === "failed" && <span className="lb-chip is-failed">Couldn't open</span>}
    </div>
  );
  if (entry.status === "loading") {
    return (
      <div className="lb-reader is-loading">
        {head}
        <div className="lb-opening"><Loader2 size={14} className="lb-spin" /> Opening the page…</div>
        <div className="lb-skeleton lb-skeleton-short"><span style={{ width: "92%" }} /><span style={{ width: "78%" }} /><span style={{ width: "85%" }} /><span style={{ width: "64%" }} /></div>
      </div>
    );
  }
  if (entry.status === "blocked" || entry.status === "failed") {
    return (
      <div className="lb-reader is-unusable">
        {head}
        <div className="lb-notice">
          {entry.status === "blocked" ? <Ban size={16} /> : <AlertTriangle size={16} />}
          <p><strong>{entry.status === "blocked" ? "The site blocked the visit" : "The page didn't load"}:</strong> {entry.reason}. Nothing from this page is used in the answer.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="lb-reader">
      {head}
      {entry.status === "partial" && <div className="lb-partial">{entry.reason}.</div>}
      <div className="lb-excerpt-label">What VetroAI read on this page</div>
      <div className="lb-excerpt">{entry.excerpt}</div>
      {entry.video && (
        <div className="lb-video-note">
          {entry.video.hasTranscript ? "Captions read — what is said in the video is included." : "No captions available — what is said in the video wasn't read."}
        </div>
      )}
    </div>
  );
}

function ReadList({ entries, numbers }) {
  const search = entries.find((e) => e.kind === "search");
  const visits = entries.filter((e) => e.kind === "visit");
  return (
    <div className="lb-list">
      <div className="lb-list-head">
        Pages VetroAI opened{search ? <> for “{search.query}”</> : null}
      </div>
      {!visits.length && <p className="lb-list-empty">{search?.status === "done" ? "The search found no pages to open." : "No pages were opened."}</p>}
      <ol>
        {visits.map((e) => (
          <li key={e.id} className={`is-${e.status}`}>
            <span className="lb-list-n">{numbers.get(e.id) ? `[${numbers.get(e.id)}]` : "–"}</span>
            <SourceFavicon domain={e.domain} />
            <div className="lb-list-main">
              <a href={e.url} target="_blank" rel="noopener noreferrer">{e.title || e.domain}</a>
              <span title={e.reason || undefined}>{e.status === "read" ? `Read · ${e.domain}` : e.status === "loading" ? `Opening… · ${e.domain}` : `${e.status === "partial" ? "Partly read" : e.status === "blocked" ? "Blocked" : "Couldn't open"}: ${e.reason}`}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── the replay ──────────────────────────────────────────────────────────────

// Positions (percent of the window body) the cursor travels to.
const SPOT = { box: [46, 30], button: [83, 30], result: [30, 58], page: [62, 62], idle: [74, 80], url: [40, 0] };

function PageShot({ url, domain, title }) {
  const shots = useMemo(() => screenshotUrls(url), [url]);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const failed = attempt >= shots.length;
  return (
    <div className="lb-page">
      {!failed && (
        <img
          key={attempt}
          src={shots[attempt]}
          alt=""
          referrerPolicy="no-referrer"
          className={`lb-shot${loaded ? " is-loaded" : ""}`}
          onLoad={(e) => { if (e.currentTarget.naturalWidth < 50) setAttempt((n) => n + 1); else setLoaded(true); }}
          onError={() => setAttempt((n) => n + 1)}
        />
      )}
      {(failed || !loaded) && (
        <div className="lb-skeleton">
          <div className="lb-skel-head"><SourceFavicon domain={domain} /><strong>{title || domain}</strong></div>
          <span style={{ width: "92%" }} /><span style={{ width: "78%" }} /><span style={{ width: "85%" }} />
          <div className="lb-skel-block" />
          <span style={{ width: "88%" }} /><span style={{ width: "70%" }} /><span style={{ width: "82%" }} /><span style={{ width: "60%" }} />
        </div>
      )}
    </div>
  );
}

function ReplayBrowser({ research, sources, query = "", live }) {
  const actions = useMemo(() => browserActions({ research, sources, query }), [research, sources, query]);
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState({ phase: "idle", typed: "", cursor: SPOT.idle, click: 0, scroll: 0 });
  const [replayKey, setReplayKey] = useState(0);
  const timers = useRef([]);
  const action = actions[Math.min(index, actions.length - 1)];

  // Plays one action, then moves to the next. Falls behind? Plays faster.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (index >= actions.length) return undefined;
    const a = actions[index];
    const behind = actions.length - index;
    const k = !live ? 0.55 : behind > 8 ? 0.35 : behind > 4 ? 0.6 : 1;
    let t = 0;
    const at = (ms, fn) => { t += ms * k; timers.current.push(setTimeout(fn, t)); };
    const click = () => setFrame((f) => ({ ...f, click: f.click + 1 }));
    if (a.type === "search") {
      at(0, () => setFrame((f) => ({ ...f, phase: "search", typed: "", scroll: 0, cursor: SPOT.box })));
      const chars = a.query.length;
      at(650, click);
      const step = Math.max(18, Math.min(55, 1100 / Math.max(chars, 1)));
      for (let i = 1; i <= chars; i++) at(step, () => setFrame((f) => ({ ...f, typed: a.query.slice(0, i) })));
      at(250, () => setFrame((f) => ({ ...f, cursor: SPOT.button })));
      at(550, () => { click(); setFrame((f) => ({ ...f, phase: "results" })); });
      at(1100, () => setFrame((f) => ({ ...f, cursor: SPOT.result })));
      at(500, () => setIndex((n) => n + 1));
    } else {
      at(0, () => { click(); setFrame((f) => ({ ...f, phase: "loading", typed: a.url, scroll: 0, cursor: SPOT.result })); });
      at(800, () => setFrame((f) => ({ ...f, phase: "page", cursor: SPOT.page })));
      at(700, () => setFrame((f) => ({ ...f, scroll: 18 })));
      at(700, () => { click(); setFrame((f) => ({ ...f, scroll: 38, cursor: [52, 48] })); });
      at(900, () => setFrame((f) => ({ ...f, scroll: 55, cursor: SPOT.idle })));
      at(400, () => setIndex((n) => n + 1));
    }
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [index, actions, live, replayKey]);

  if (!actions.length) {
    if (!live) return null;
    return (
      <div className="lb">
        <BrowserBar url="" live />
        <div className="lb-body"><div className="lb-start"><Search size={18} /> Opening the browser…</div></div>
      </div>
    );
  }

  const caughtUp = index >= actions.length;
  const shown = caughtUp ? actions[actions.length - 1] : action;
  const pagesRead = actions.filter((a) => a.type === "visit").length;
  const searches = actions.filter((a) => a.type === "search").length;
  const phase = caughtUp ? (shown.type === "visit" ? "page" : "results") : frame.phase;
  const url = phase === "loading" || phase === "page" ? (shown.url || "") : `vetroai.app/search?q=${encodeURIComponent(shown.type === "search" ? shown.query : "")}`;
  const nextResults = actions.slice(index + 1).filter((a) => a.type === "visit").slice(0, 3);

  return (
    <div className={`lb${live ? " is-live" : ""}`} aria-label="VetroAI's browser">
      <BrowserBar url={url} live={live && !caughtUp} loading={phase === "loading"} />
      <div className="lb-body">
        {(phase === "search" || phase === "results" || phase === "idle") && shown.type === "search" && (
          <div className="lb-search">
            <div className="lb-logo">Vetro<span>AI</span> Search</div>
            <div className="lb-box">
              <Search size={14} />
              <span className="lb-typed">{phase === "search" && !caughtUp ? frame.typed : shown.query}<i className="lb-caret" /></span>
              <span className="lb-go">Search</span>
            </div>
            {phase === "results" && (
              <div className="lb-results">
                {(nextResults.length ? nextResults : actions.filter((a) => a.type === "visit").slice(-3)).map((r, i) => (
                  <div key={r.domain} className={`lb-result${i === 0 ? " is-target" : ""}`} style={{ animationDelay: `${i * 90}ms` }}>
                    <span className="lb-result-site"><SourceFavicon domain={r.domain} /> {r.domain}</span>
                    <strong>{r.title}</strong>
                  </div>
                ))}
                {!nextResults.length && !actions.some((a) => a.type === "visit") && <div className="lb-result"><strong>Reading the results…</strong></div>}
              </div>
            )}
          </div>
        )}
        {(phase === "loading" || phase === "page") && shown.type === "visit" && (
          <div className={`lb-pagewrap${phase === "loading" ? " is-loading" : ""}`} style={{ "--scroll": `${caughtUp ? 0 : frame.scroll}%` }}>
            <PageShot key={shown.url} url={shown.url} domain={shown.domain} title={shown.title} />
            {phase === "page" && !caughtUp && <div className="lb-reading" style={{ top: `${30 + (frame.scroll / 3)}%` }} />}
          </div>
        )}
        {!caughtUp && (
          <div className="lb-cursor" style={{ left: `${frame.cursor[0]}%`, top: `${frame.cursor[1]}%` }}>
            <span key={frame.click} className="lb-click" />
            <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true"><path d="M1 1 L1 15.2 L4.9 11.6 L7.4 17.2 L10 16 L7.6 10.6 L12.8 10.3 Z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          </div>
        )}
      </div>
      <div className="lb-foot">
        <span className={`lb-dot${live && !caughtUp ? " is-live" : ""}`} />
        {live && !caughtUp
          ? (shown.type === "search" ? <>Searching “{shown.query}”</> : <>Reading {shown.domain}</>)
          : live ? "Working on what it found…" : `${searches} search${searches === 1 ? "" : "es"} · ${pagesRead} page${pagesRead === 1 ? "" : "s"} read`}
        {!live && caughtUp && <button type="button" onClick={() => { setIndex(0); setReplayKey((n) => n + 1); }}><RotateCw size={12} /> Replay</button>}
      </div>
    </div>
  );
}

function BrowserBar({ url, live, loading }) {
  const secure = /^https:/.test(url) || url.startsWith("vetroai.app");
  return (
    <div className="lb-bar">
      <span className="lb-dots"><i /><i /><i /></span>
      <span className="lb-nav"><ArrowLeft size={13} /><ArrowRight size={13} /></span>
      <span className="lb-url">
        {secure && <Lock size={11} />}
        <span>{url.replace(/^https?:\/\//, "") || "about:blank"}</span>
        {loading && <span className="lb-load" />}
      </span>
      {live && <span className="lb-live">LIVE</span>}
    </div>
  );
}
