import React, { useMemo, useState } from "react";
import { BookOpen, Check, Download, FileText, Loader2, X } from "lucide-react";
import { courseMarkdown } from "../../lib/course";
import { exportDocx, exportPdf } from "../../lib/documentExport";
import "./CourseCard.css";

// A course being written (lib/course.js): its chapters ticking off as they
// arrive, then the whole course as a PDF or a Word file.
export default function CourseCard({ course }) {
  const [busy, setBusy] = useState("");
  const [failed, setFailed] = useState("");
  const chapters = course.chapters || [];
  const done = chapters.filter((c) => c.state === "done").length;
  const missing = chapters.filter((c) => c.state === "failed").length;
  const finished = course.phase === "done";
  const book = useMemo(() => (finished ? courseMarkdown(course) : ""), [finished, course]);
  const percent = chapters.length ? Math.round((done / chapters.length) * 100) : 0;

  const download = async (kind) => {
    setBusy(kind);
    setFailed("");
    try {
      if (kind === "pdf") await exportPdf(book, { book: true });
      else await exportDocx(book);
    } catch (err) {
      setFailed(`Couldn't make the ${kind === "pdf" ? "PDF" : "Word file"}: ${err.message}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="vai-course not-prose">
      <div className="vai-course-head">
        <BookOpen size={18} />
        <div className="vai-course-titles">
          <strong>{course.title || "Planning your course…"}</strong>
          {course.audience && <small>{course.audience}</small>}
        </div>
      </div>

      {course.phase === "error" ? (
        <div className="vai-course-error">{course.error}</div>
      ) : (
        <>
          <div className="vai-course-progress" aria-label={`${done} of ${chapters.length} chapters written`}>
            <span style={{ width: `${finished ? 100 : percent}%` }} />
          </div>
          <div className="vai-course-status">
            {finished
              ? `${done} chapters written${missing ? `, ${missing} couldn't be written` : ""}. Your course is ready.`
              : course.status || "Starting…"}
          </div>
        </>
      )}

      {chapters.length > 0 && (
        <ol className="vai-course-chapters">
          {chapters.map((c, i) => (
            <li key={i} className={`is-${c.state}`}>
              <span className="vai-course-mark">
                {c.state === "done" ? <Check size={13} /> : c.state === "failed" ? <X size={13} /> : finished ? null : <Loader2 size={13} className="vai-course-spin" />}
              </span>
              <span>{i + 1}. {c.title}</span>
            </li>
          ))}
        </ol>
      )}

      {finished && done > 0 && (
        <div className="vai-course-actions">
          <button type="button" onClick={() => download("pdf")} disabled={!!busy}>
            {busy === "pdf" ? <Loader2 size={15} className="vai-course-spin" /> : <Download size={15} />} Download PDF
          </button>
          <button type="button" onClick={() => download("docx")} disabled={!!busy}>
            {busy === "docx" ? <Loader2 size={15} className="vai-course-spin" /> : <FileText size={15} />} Word
          </button>
        </div>
      )}
      {failed && <div className="vai-course-error">{failed}</div>}
    </div>
  );
}
