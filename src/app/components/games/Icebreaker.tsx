'use client';

import { useRef, useState } from 'react';
import {
  choiceButtonStyle,
  mutedTextStyle,
  panelStyle,
  primaryButtonStyle,
  statusTextStyle,
} from './game-theme';
import type { GameOutcome, GamePlayerProps } from './surface';
import { ICEBREAKER_MAX_SCORE, ICEBREAKER_QUESTIONS } from './game-banks';

/**
 * `icebreaker` — six fixed questions, four options each, one correct.
 *
 * Score = correct answers scaled to the catalogue ceiling of 50. The bank is a
 * literal in `game-banks.ts`, so the round is identical everywhere and needs no
 * network round-trip.
 */
export default function Icebreaker({ onFinish }: GamePlayerProps) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const finishedRef = useRef(false);

  const total = ICEBREAKER_QUESTIONS.length;
  const question = ICEBREAKER_QUESTIONS[step];
  const answered = picked !== null;
  const isLast = step === total - 1;

  const choose = (option: number) => {
    if (answered) return;
    setPicked(option);
    if (option === question.answerIndex) setCorrect((prev) => prev + 1);
  };

  const advance = () => {
    if (!answered) return;

    if (isLast) {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const score = Math.round((correct / total) * ICEBREAKER_MAX_SCORE);
      const outcome: GameOutcome =
        correct === total ? 'win' : correct * 2 >= total ? 'draw' : 'loss';
      onFinish(outcome, score);
      return;
    }

    setStep((prev) => prev + 1);
    setPicked(null);
  };

  return (
    <div style={panelStyle} data-testid="icebreaker" data-step={step}>
      <p style={statusTextStyle}>
        Question {step + 1}/{total} · Correct {correct}
      </p>
      <p style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#F2E9E4', lineHeight: 1.4 }}>
        {question.prompt}
      </p>

      <div style={{ display: 'grid', gap: '10px' }} data-testid="icebreaker-options">
        {question.options.map((option, index) => (
          <button
            key={option}
            type="button"
            onClick={() => choose(index)}
            disabled={answered}
            style={choiceButtonStyle(
              answered
                ? index === question.answerIndex || index === picked
                : index === picked,
              answered
                ? index === question.answerIndex
                  ? 'good'
                  : index === picked
                    ? 'bad'
                    : 'neutral'
                : 'neutral'
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {answered && (
        <p style={statusTextStyle} role="status">
          {picked === question.answerIndex
            ? 'Correct! 🎉'
            : `Not quite — the answer is ${question.options[question.answerIndex]}.`}
        </p>
      )}

      {answered && (
        <button type="button" onClick={advance} style={primaryButtonStyle} data-testid="icebreaker-next">
          {isLast ? 'See my score' : 'Next question →'}
        </button>
      )}

      <p style={mutedTextStyle}>
        Six questions about Nepal and about the way people meet. Every correct answer is worth{' '}
        {Math.round(ICEBREAKER_MAX_SCORE / total)} points.
      </p>
    </div>
  );
}
