'use client';

import { useMemo, useRef, useState } from 'react';
import {
  choiceButtonStyle,
  ghostButtonStyle,
  mutedTextStyle,
  panelStyle,
  primaryButtonStyle,
  statusTextStyle,
} from './game-theme';
import { useGameRound, type GameOutcome, type GamePlayerProps } from './surface';
import {
  TWENTY_QUESTIONS_FEATURES,
  TWENTY_QUESTIONS_MAX_SCORE,
  TWENTY_QUESTIONS_PENALTY,
  TWENTY_QUESTIONS_SUBJECTS,
  twentyQuestionsSubjectFor,
  type TwentyQuestionsFeature,
} from './game-banks';

/**
 * `twenty-questions` — the app asks yes/no questions and narrows a hidden
 * answer, one split at a time.
 *
 * The next question is chosen by the most even split of whatever candidates are
 * still standing, so the search is deterministic and always converges: every
 * subject in the bank has a distinct feature vector. Score is out of 30 and
 * rewarded for *fewer* questions used.
 */

interface AskedQuestion {
  id: string;
  question: string;
  answer: boolean;
}

/** The most balanced unasked feature that still separates the candidates. */
function nextQuestion(remaining: readonly string[], asked: readonly string[]): TwentyQuestionsFeature | null {
  let best: TwentyQuestionsFeature | null = null;
  let bestBalance = Number.POSITIVE_INFINITY;

  for (const feature of TWENTY_QUESTIONS_FEATURES) {
    if (asked.includes(feature.id)) continue;

    const yes = TWENTY_QUESTIONS_SUBJECTS.filter(
      (subject) => remaining.includes(subject.id) && subject.features.includes(feature.id)
    ).length;
    const no = remaining.length - yes;
    if (yes === 0 || no === 0) continue;

    const balance = Math.abs(yes - no);
    if (balance < bestBalance) {
      bestBalance = balance;
      best = feature;
    }
  }

  return best;
}

export default function TwentyQuestions({ onFinish }: GamePlayerProps) {
  const round = useGameRound();
  const hidden = useMemo(() => twentyQuestionsSubjectFor(round), [round]);

  const [remaining, setRemaining] = useState<string[]>(() =>
    TWENTY_QUESTIONS_SUBJECTS.map((subject) => subject.id)
  );
  const [history, setHistory] = useState<AskedQuestion[]>([]);
  const finishedRef = useRef(false);

  const askedIds = useMemo(() => history.map((entry) => entry.id), [history]);
  const stumped = remaining.length === 0;
  const question = stumped || remaining.length === 1 ? null : nextQuestion(remaining, askedIds);
  const guessedId = remaining.length > 0 ? remaining[0] : hidden.id;
  const guessed = TWENTY_QUESTIONS_SUBJECTS.find((subject) => subject.id === guessedId) ?? hidden;

  const finish = (outcome: GameOutcome, score: number) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish(outcome, score);
  };

  const answer = (yes: boolean) => {
    if (!question) return;

    const yesIds = TWENTY_QUESTIONS_SUBJECTS.filter((subject) =>
      subject.features.includes(question.id)
    ).map((subject) => subject.id);

    setRemaining((prev) => prev.filter((id) => (yes ? yesIds.includes(id) : !yesIds.includes(id))));
    setHistory((prev) => [...prev, { id: question.id, question: question.question, answer: yes }]);
  };

  const scoreIfRight = Math.max(
    0,
    TWENTY_QUESTIONS_MAX_SCORE - (history.length - 1) * TWENTY_QUESTIONS_PENALTY
  );

  return (
    <div style={panelStyle} data-testid="twenty-questions" data-asked={history.length}>
      <p style={statusTextStyle}>
        Questions used {history.length} · Still considering {remaining.length}
      </p>

      {stumped ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
            You stumped me — no answer in my list matches every yes and no.
          </p>
          <button
            type="button"
            style={ghostButtonStyle}
            onClick={() => finish('loss', 0)}
            data-testid="twenty-questions-stumped"
          >
            Finish the round
          </button>
        </div>
      ) : question ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p
            style={{ margin: 0, fontSize: '17px', fontWeight: 800, lineHeight: 1.4 }}
            data-testid="twenty-questions-prompt"
          >
            {question.question}
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              style={choiceButtonStyle(false, 'good')}
              onClick={() => answer(true)}
              data-testid="twenty-questions-yes"
            >
              Yes
            </button>
            <button
              type="button"
              style={choiceButtonStyle(false, 'bad')}
              onClick={() => answer(false)}
              data-testid="twenty-questions-no"
            >
              No
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '17px', fontWeight: 800, lineHeight: 1.4 }} data-testid="twenty-questions-guess">
            I think I know. Is it {guessed.label}?
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => finish('win', scoreIfRight)}
              data-testid="twenty-questions-guess-yes"
            >
              Yes, that&rsquo;s it!
            </button>
            <button
              type="button"
              style={ghostButtonStyle}
              onClick={() => finish('loss', 0)}
              data-testid="twenty-questions-guess-no"
            >
              Not quite
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '4px' }}>
          {history.map((entry) => (
            <li key={entry.id} style={{ ...mutedTextStyle, fontSize: '12px' }}>
              {entry.answer ? 'Yes —' : 'No —'} {entry.question}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
