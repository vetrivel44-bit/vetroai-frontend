import { useEffect, useState } from "react";
import { findReferenceDiagrams } from "../../../lib/referenceDiagrams";

/**
 * Textbook diagrams of `subject` once `ready`: { status: "idle" | "searching"
 * | "found" | "none", list }. "none" also covers a search that couldn't be
 * reached, so the card falls back quietly.
 */
export function useReferenceDiagrams(subject, ready) {
  const [state, setState] = useState({ key: "", status: "idle", list: [] });
  useEffect(() => {
    if (!ready || !subject) return undefined;
    let live = true;
    findReferenceDiagrams(subject)
      .then((list) => { if (live) setState({ key: subject, status: list.length ? "found" : "none", list }); })
      .catch(() => { if (live) setState({ key: subject, status: "none", list: [] }); });
    return () => { live = false; };
  }, [subject, ready]);
  if (!ready || !subject) return { status: "idle", list: [] };
  return state.key === subject ? state : { status: "searching", list: [] };
}
