// TEMPORARY local preview of the course card (deleted after checking).
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import CourseCard from "./components/chat/CourseCard";
import { applyCourseEvent } from "./lib/course";

function Preview() {
  const [states, setStates] = useState(null);
  useEffect(() => {
    fetch("/zz-course-events.json").then((r) => r.json()).then((events) => {
      let course = { id: "x", phase: "running", title: "", chapters: [], status: "Planning the course…" };
      const snaps = { planning: course };
      events.forEach((e, i) => {
        course = applyCourseEvent(course, e);
        if (e.type === "chapter" && !snaps.midway && course.chapters.filter((c) => c.state === "done").length >= 3) snaps.midway = course;
      });
      snaps.done = course;
      setStates(snaps);
    });
  }, []);
  if (!states) return <p>Loading…</p>;
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  return (
    <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 16px", display: "grid", gap: 24 }}>
      <h3>While planning</h3><CourseCard course={states.planning} />
      <h3>Midway</h3>{states.midway && <CourseCard course={states.midway} />}
      <h3>Finished</h3><CourseCard course={states.done} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Preview />);
