import React, { useContext, useMemo } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import { VisualFallback, VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { ReplyContext, parseChoices } from "../../../lib/choices";
import "./visuals.css";

// A ```choices block as it sits in the reply: just the question. While it is
// the newest unanswered message its options are docked above the input box
// (ChoicePanel); once answered, the reply keeps the answer under it.
export default function ChoiceBlock({ code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const reply = useContext(ReplyContext);
  const parsed = useMemo(() => {
    if (pending) return null;
    try { return { data: parseChoices(code) }; } catch (err) { return { error: String(err.message || err).split("\n")[0] }; }
  }, [code, pending]);

  if (pending) return <VisualPending icon={MessageCircleQuestion} label="Preparing options…" />;
  if (parsed?.error) return <VisualFallback what="question" error={parsed.error} fallback={fallback} />;

  const { question, options } = parsed.data;
  const answer = reply?.reply;
  const docked = !answer && reply?.canReply;
  return (
    <div className="vetro-choice-inline not-prose">
      <div className="vetro-choice-q"><MessageCircleQuestion size={18} /> <span>{question}</span></div>
      {answer ? (
        <div className="vetro-choice-answer"><Check size={14} /> {answer}</div>
      ) : docked ? (
        <div className="vetro-choice-hint">Pick an answer below, or type your own.</div>
      ) : (
        <ul className="vetro-choice-static">{options.map((o, i) => <li key={i}>{o.label}{o.description ? ` — ${o.description}` : ""}</li>)}</ul>
      )}
    </div>
  );
}
