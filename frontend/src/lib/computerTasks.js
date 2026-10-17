// Nothing is running when Computer opens. A task saved mid-run — the page was
// closed, reloaded or put away on a phone — used to stay "running" for good,
// which kept the send button switched off with no way to send anything.
const INTERRUPTED = "Stopped — the page was closed while this was running. Send it again to retry.";
export function settleInterruptedTasks(tasks) {
  return tasks.map((t) => {
    if (!["running", "paused"].includes(t?.status)) return t;
    return {
      ...t,
      status: "stopped",
      steps: (t.steps || []).map((step) => (step.status === "active" ? { ...step, status: "pending" } : step)),
      messages: (t.messages || []).map((m) => {
        if (m.role !== "assistant") return m;
        if (m.folder && ["planning", "applying", "undoing"].includes(m.folder.status)) {
          return { ...m, folder: { ...m.folder, status: m.folder.ops?.length ? "ready" : "failed", error: INTERRUPTED, progress: null } };
        }
        if (m.report && m.report.status !== "done" && m.report.status !== "failed") return { ...m, report: { ...m.report, status: "failed", error: INTERRUPTED } };
        if (m.run && ["researching", "making"].includes(m.run.status)) return { ...m, run: { ...m.run, status: m.run.report ? "done" : "failed", error: INTERRUPTED } };
        if (!m.content && !m.folder && !m.report && !m.run) return { ...m, content: INTERRUPTED, finishedAt: m.finishedAt || Date.now() };
        return m;
      }),
    };
  });
}
