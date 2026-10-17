import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BellRing, CalendarClock, ChevronDown, Clock3, Eye, Loader2, Mail, Pause, Play, Plus, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import { formatWhen, parseScheduleText, schedulesApi } from "../../lib/schedules";

// Computer → Scheduled: tasks that run while you're away, and what they found.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EXAMPLES = [
  "Every morning at 8, send me today's top news in India and the cricket scores",
  "Tell me when the iPhone 17 drops below ₹70,000 on Amazon",
  "Every Monday at 9 am, a summary of last week's AI news",
];

function ScheduleForm({ initial, onCancel, onSave, saving, error }) {
  const [text, setText] = useState(initial?.text || "");
  const parsed = useMemo(() => parseScheduleText(text), [text]);
  const [kind, setKind] = useState(initial?.kind || parsed.kind);
  const [condition, setCondition] = useState(initial?.condition || parsed.condition);
  const [every, setEvery] = useState(initial?.schedule?.every || parsed.schedule.every);
  const [time, setTime] = useState(initial?.schedule?.time || parsed.schedule.time || "08:00");
  const [day, setDay] = useState(initial?.schedule?.day ?? parsed.schedule.day ?? 1);
  const [hours, setHours] = useState(initial?.schedule?.hours || parsed.schedule.hours || 6);
  const [touched, setTouched] = useState(Boolean(initial?.schedule));

  // Typing the request fills in the rest until the user changes it by hand.
  useEffect(() => {
    if (touched) return;
    setKind(parsed.kind);
    setCondition(parsed.condition);
    setEvery(parsed.schedule.every);
    if (parsed.schedule.time) setTime(parsed.schedule.time);
    if (parsed.schedule.day != null) setDay(parsed.schedule.day);
    if (parsed.schedule.hours) setHours(parsed.schedule.hours);
  }, [parsed, touched]);
  const touch = (fn) => (e) => { setTouched(true); fn(e.target.value); };

  const submit = (e) => {
    e.preventDefault();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const schedule = every === "hours" ? { every, hours: Number(hours), tz } : every === "week" ? { every, day: Number(day), time, tz } : { every, time, tz };
    onSave({ prompt: kind === "watch" ? (condition || parsed.prompt) : parsed.prompt || text, title: parsed.title || text.slice(0, 60), kind, condition: kind === "watch" ? condition : "", schedule });
  };

  return (
    <form className="cw-sched-form" onSubmit={submit}>
      <label className="cw-sched-label">What should VetroAI do?</label>
      <textarea autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Every morning at 8, send me today's top news and the cricket scores" />
      <div className="cw-sched-kinds" role="radiogroup" aria-label="Kind of task">
        <button type="button" role="radio" aria-checked={kind === "brief"} className={kind === "brief" ? "is-on" : ""} onClick={() => { setTouched(true); setKind("brief"); }}><BellRing size={14} /> Send me an update</button>
        <button type="button" role="radio" aria-checked={kind === "watch"} className={kind === "watch" ? "is-on" : ""} onClick={() => { setTouched(true); setKind("watch"); }}><Eye size={14} /> Tell me only when…</button>
      </div>
      {kind === "watch" && (
        <input className="cw-sched-input" value={condition} onChange={touch(setCondition)} placeholder="e.g. the price drops below ₹70,000" />
      )}
      <div className="cw-sched-when">
        <select value={every} onChange={touch(setEvery)} aria-label="How often">
          <option value="day">Every day</option>
          <option value="week">Every week</option>
          <option value="hours">Every few hours</option>
        </select>
        {every === "week" && (
          <select value={day} onChange={touch(setDay)} aria-label="Day">
            {DAY_NAMES.map((d, i) => <option key={d} value={i}>on {d}</option>)}
          </select>
        )}
        {every === "hours"
          ? <select value={hours} onChange={touch(setHours)} aria-label="Hours">{[1, 2, 3, 4, 6, 8, 12, 24].map((h) => <option key={h} value={h}>every {h} hour{h === 1 ? "" : "s"}</option>)}</select>
          : <input type="time" value={time} onChange={touch(setTime)} aria-label="Time" />}
      </div>
      {error && <p className="cw-sched-error"><TriangleAlert size={14} /> {error}</p>}
      <div className="cw-sched-actions">
        <button type="button" className="is-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="is-primary" disabled={saving || text.trim().length < 4 || (kind === "watch" && !condition.trim())}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />} Schedule it
        </button>
      </div>
    </form>
  );
}

function TaskCard({ task, onToggle, onRun, onDelete, onOpen, busy, renderMarkdown }) {
  const [open, setOpen] = useState(false);
  const last = task.runs?.[0];
  const toggleOpen = () => { setOpen((v) => !v); if (!open && task.unread) onOpen(task); };
  return (
    <div className={`cw-sched-card${task.active ? "" : " is-paused"}`}>
      <div className="cw-sched-card-head">
        <span className={`cw-sched-icon is-${task.kind}`}>{task.kind === "watch" ? <Eye size={16} /> : <BellRing size={16} />}</span>
        <div className="cw-sched-card-text">
          <strong>{task.title}{task.unread > 0 && <span className="cw-sched-new">{task.unread} new</span>}</strong>
          <small>
            <Clock3 size={12} /> {task.kind === "watch" ? `Checks ${task.when.toLowerCase()}` : task.when}
            {task.active && task.nextRunAt ? <> · next {formatWhen(task.nextRunAt)}</> : !task.active && task.kind === "watch" && last?.met ? " · done — it happened" : !task.active ? " · paused" : ""}
          </small>
        </div>
        <div className="cw-sched-card-actions">
          <button type="button" onClick={() => onRun(task)} disabled={busy} title="Run it now">{busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />}</button>
          <button type="button" onClick={() => onToggle(task)} title={task.active ? "Pause" : "Resume"}>{task.active ? <Pause size={15} /> : <Play size={15} />}</button>
          <button type="button" onClick={() => onDelete(task)} title="Delete" className="is-danger"><Trash2 size={15} /></button>
        </div>
      </div>
      {task.kind === "watch" && <p className="cw-sched-condition">Watching for: {task.condition}</p>}
      {last && (
        <button type="button" className="cw-sched-last" onClick={toggleOpen} aria-expanded={open}>
          <span className={`cw-sched-dot ${last.ok ? (task.kind === "watch" ? (last.met ? "is-met" : "is-wait") : "is-ok") : "is-fail"}`} />
          <span className="cw-sched-last-text">
            {last.ok ? (task.kind === "watch" ? (last.met ? `It happened: ${last.value || "condition met"}` : `Not yet${last.value ? ` — ${last.value}` : ""}`) : "Latest update") : `Couldn't run: ${last.error}`}
            <em>{formatWhen(last.at)}</em>
          </span>
          <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </button>
      )}
      {open && (
        <div className="cw-sched-runs">
          {task.runs.slice(0, 8).map((run, i) => (
            <div key={i} className="cw-sched-run">
              <div className="cw-sched-run-when">{formatWhen(run.at)}{task.kind === "watch" && run.ok ? (run.met ? " · condition met" : " · not yet") : ""}</div>
              {run.ok ? <div className="cw-sched-run-body">{renderMarkdown(run.text || run.value || "")}</div> : <div className="cw-sched-error"><TriangleAlert size={13} /> {run.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ScheduledPanel({ api, draft, onDraftUsed, onUnread }) {
  const client = useMemo(() => schedulesApi(api), [api]);
  const [state, setState] = useState({ status: "loading" });
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await client.list();
      setState({ status: "ready", ...data });
      onUnread?.(data.unread || 0);
    } catch (err) {
      setState({ status: "error", message: err.message });
    }
  }, [client, onUnread]);

  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  // A request typed in the composer ("every morning at 8…") opens the form filled in.
  useEffect(() => {
    if (!draft) return;
    setForm({ text: draft });
    setFormError("");
    onDraftUsed?.();
  }, [draft, onDraftUsed]);

  const save = async (task) => {
    setSaving(true);
    setFormError("");
    try {
      await client.create(task);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const act = async (task, fn) => {
    setBusyId(task.id);
    try { await fn(); await load(); } catch (err) { setState((s) => ({ ...s, actionError: err.message })); } finally { setBusyId(""); }
  };

  const tasks = state.tasks || [];
  const renderMarkdown = (md) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>;

  return (
    <section className="cowork-home-scroll">
      <div className="cw-sched">
        <div className="cw-sched-head">
          <div>
            <h1 className="cowork-title" style={{ fontSize: 30, marginBottom: 4 }}>Scheduled</h1>
            <p className="cowork-subtitle" style={{ margin: 0 }}>VetroAI does these on its own — even when this app is closed — and keeps what it finds here.</p>
          </div>
          {!form && <button type="button" className="cw-sched-new-btn" onClick={() => { setForm({ text: "" }); setFormError(""); }}><Plus size={15} /> New</button>}
        </div>

        {state.status === "ready" && !state.durable && (
          <p className="cw-sched-banner"><TriangleAlert size={15} /> This server has no database yet, so scheduled tasks are kept only until it restarts. The owner can fix this by setting MONGO_URI (see DEPLOY.md).</p>
        )}
        {state.status === "ready" && state.email && <p className="cw-sched-banner is-ok"><Mail size={15} /> Results are also emailed to you.</p>}
        {state.actionError && <p className="cw-sched-error"><TriangleAlert size={14} /> {state.actionError}</p>}

        {form && <ScheduleForm key={form.text} initial={form} onCancel={() => setForm(null)} onSave={save} saving={saving} error={formError} />}

        {state.status === "loading" && <p className="cw-sched-muted"><Loader2 size={15} className="animate-spin" /> Loading your scheduled tasks…</p>}
        {state.status === "error" && <p className="cw-sched-error"><TriangleAlert size={14} /> {state.message}</p>}
        {state.status === "ready" && tasks.length === 0 && !form && (
          <div className="cw-sched-empty">
            <CalendarClock size={26} />
            <strong>Nothing scheduled yet</strong>
            <span>Try one of these:</span>
            <div className="cw-sched-examples">
              {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setForm({ text: ex })}>{ex}</button>)}
            </div>
          </div>
        )}
        <div className="cw-sched-list">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              busy={busyId === task.id}
              renderMarkdown={renderMarkdown}
              onOpen={(t) => act(t, () => client.markRead(t.id))}
              onRun={(t) => act(t, () => client.runNow(t.id))}
              onToggle={(t) => act(t, () => client.update(t.id, { active: !t.active }))}
              onDelete={(t) => { if (window.confirm(`Delete “${t.title}”?`)) act(t, () => client.remove(t.id)); }}
            />
          ))}
        </div>
        {form === null && tasks.length > 0 && <button type="button" className="cw-sched-close" onClick={() => setForm({ text: "" })}><Plus size={14} /> Schedule another</button>}
      </div>
    </section>
  );
}
