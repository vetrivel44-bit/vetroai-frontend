import React, { useContext, useMemo, useState } from "react";
import { HelpCircle, RotateCcw, Trophy } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { LETTERS, parseQuiz, scoreQuiz, verdict } from "../../../lib/quiz";

// A ```quiz block: a KBC-style multiple-choice test, one question at a time.
// Pick an option, lock it in, see if it was right, move on. The last screen
// shows the score and walks through every mistake in simple words with an
// example.

function Results({ quiz, picks, onRetry }) {
  const { score, total, percent, mistakes } = scoreQuiz(quiz, picks);
  return (
    <div className="vetro-quiz-results">
      <div className="vetro-quiz-score">
        <Trophy size={28} />
        <div>
          <strong>{score} / {total}</strong>
          <span>{percent}% · {verdict(percent)}</span>
        </div>
      </div>
      {mistakes.length > 0 && (
        <>
          <h4 className="vetro-quiz-subhead">Let’s fix your mistakes</h4>
          <ol className="vetro-quiz-mistakes">
            {mistakes.map((m) => (
              <li key={m.index}>
                <p className="vetro-quiz-mq">Q{m.index + 1}. {m.question}</p>
                <p className="vetro-quiz-wrong">
                  Your answer: {m.picked == null ? "—" : `${LETTERS[m.picked]}. ${m.options[m.picked]}`}
                </p>
                <p className="vetro-quiz-right">Correct answer: {LETTERS[m.answer]}. {m.options[m.answer]}</p>
                {m.explanation && <p><strong>In simple words:</strong> {m.explanation}</p>}
                {m.example && <p className="vetro-quiz-example"><strong>Example:</strong> {m.example}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
      <button type="button" className="vetro-quiz-btn" onClick={onRetry}><RotateCcw size={14} /> Try again</button>
    </div>
  );
}

export default function QuizBlock({ code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const parsed = useMemo(() => {
    if (pending) return null;
    try { return { quiz: parseQuiz(code) }; } catch (err) { return { error: String(err.message || err).split("\n")[0] }; }
  }, [code, pending]);

  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState([]);
  const [choice, setChoice] = useState(null);
  const [locked, setLocked] = useState(false);

  if (pending) return <VisualPending icon={HelpCircle} label="Preparing your quiz…" />;
  if (parsed?.error) return <VisualFallback what="quiz" error={parsed.error} fallback={fallback} />;

  const { quiz } = parsed;
  const total = quiz.questions.length;
  const done = step >= total;
  const q = quiz.questions[step];

  const lock = () => {
    if (choice == null) return;
    setLocked(true);
    setPicks((p) => { const n = [...p]; n[step] = choice; return n; });
  };
  const next = () => { setStep((s) => s + 1); setChoice(null); setLocked(false); };
  const retry = () => { setStep(0); setPicks([]); setChoice(null); setLocked(false); };

  const optionClass = (i) => {
    if (!locked) return i === choice ? "is-picked" : "";
    if (i === q.answer) return "is-correct";
    return i === choice ? "is-wrong" : "is-dim";
  };

  return (
    <VisualCard icon={HelpCircle} title={quiz.title} code={code} bodyClassName="vetro-quiz">
      {done ? <Results quiz={quiz} picks={picks} onRetry={retry} /> : (
        <>
          <div className="vetro-quiz-progress">
            <span>Question {step + 1} of {total}</span>
            <span className="vetro-quiz-bar"><span style={{ width: `${(step / total) * 100}%` }} /></span>
          </div>
          <div className="vetro-quiz-question">{q.question}</div>
          <div className="vetro-quiz-options" role="radiogroup" aria-label="Answer options">
            {q.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={choice === i}
                disabled={locked}
                className={`vetro-quiz-option ${optionClass(i)}`}
                onClick={() => setChoice(i)}
              >
                <span className="vetro-quiz-letter">{LETTERS[i]}</span>
                <span>{opt}</span>
              </button>
            ))}
          </div>
          {locked && (
            <p className={`vetro-quiz-feedback ${choice === q.answer ? "is-correct" : "is-wrong"}`}>
              {choice === q.answer ? "Correct! 🎉" : `Not quite — the answer is ${LETTERS[q.answer]}. We’ll explain it at the end.`}
            </p>
          )}
          <div className="vetro-quiz-actions">
            {locked
              ? <button type="button" className="vetro-quiz-btn is-primary" onClick={next}>{step + 1 === total ? "See my score" : "Next question"}</button>
              : <button type="button" className="vetro-quiz-btn is-primary" disabled={choice == null} onClick={lock}>Lock answer</button>}
          </div>
        </>
      )}
    </VisualCard>
  );
}
