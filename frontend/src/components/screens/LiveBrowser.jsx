import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Lock, RotateCw, Search } from "lucide-react";
import SourceFavicon from "../SourceFavicon";
import { browserActions, screenshotUrls } from "../../lib/browserReplay";
import "./LiveBrowser.css";

// A small browser window showing VetroAI's web work as it happens: the cursor
// goes to the search box and types each real search, clicks Search, opens a
// result; each page it read loads in the window and scrolls as it reads.
// Every search and page shown is a real one from the run (browserActions);
// the cursor and typing are how it is drawn.

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

export default function LiveBrowser({ research, sources, query = "", live }) {
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
