import { expect, test, type Page } from '@playwright/test';
import {
  ICEBREAKER_QUESTIONS,
  TRUTH_OR_DARE_TURNS,
  TWENTY_QUESTIONS_FEATURES,
  WHEEL_SEGMENTS,
  speedMatchPairsFor,
  twentyQuestionsSubjectFor,
  wordGuessRoundFor,
} from '../../src/app/components/games/game-banks';
import { signedIn, stubSupabase, type SupabaseStub } from './fixtures';

/**
 * §3.3 — the Game Zone journeys.
 *
 * These prove the embedded Game Shell end to end in a real browser: the hub
 * lists every new mini-game, and at least three of them are actually playable —
 * clicked through to a scored outcome, with the result written through
 * `record_game_result()` exactly once and never above its `max_score`.
 *
 * Determinism comes from the games themselves. Every board, deck and answer is
 * a pure function of the round number (`src/app/components/games/deterministic.ts`),
 * so this file imports the same banks the games do and can play them perfectly
 * without watching for pixels or stubbing anything below the Supabase boundary.
 */

const NEW_GAME_TITLES = [
  'Memory Match',
  'Word Guessing',
  'Icebreaker Trivia',
  '20 Questions',
  'Truth or Dare',
  'Spin the Wheel',
  'Speed Matching',
] as const;

/** Signs a member in, stubs Supabase, and lands on the Game Hub. */
async function openHub(page: Page): Promise<SupabaseStub> {
  await signedIn(page);

  const stub = await stubSupabase(page, {
    tables: {
      profiles: { display_name: 'Asha', avatar_url: null },
      game_results: [],
    },
    rpc: {
      // The ledger write itself is asserted below; the server's validation is
      // covered by tests/database, not by a browser journey.
      record_game_result: { ok: true, result_id: 'e2e-result-id' },
    },
  });

  // The hub renders remote card art. Blocking it keeps the journey deterministic
  // and makes the navigation instant, and no assertion depends on a pixel.
  await page.route('**/images.unsplash.com/**', (route) => route.fulfill({ status: 204, body: '' }));

  await page.goto('/game-zone');
  await expect(page.getByRole('button', { name: 'Play Memory Match' })).toBeVisible();

  return stub;
}

/** Clicks a hub card and waits for the shell, proving the hub routes for real. */
async function openGame(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: `Play ${title}` }).click();
  await expect(page.getByTestId('game-shell')).toBeVisible();
}

/** Marks the window so a full document reload can be detected afterwards. */
async function markNoReload(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__gameZoneNoReload = true;
  });
}

async function assertNoReload(page: Page): Promise<void> {
  const survived = await page.evaluate(() =>
    Boolean((window as unknown as Record<string, unknown>).__gameZoneNoReload)
  );
  expect(survived, 'playing a game must not reload the document').toBe(true);
}

/** Reads the outcome banner, asserting the score is inside the DB ceiling. */
async function readOutcome(page: Page): Promise<{ text: string; score: number }> {
  const banner = page.getByTestId('game-outcome');
  await expect(banner).toBeVisible();

  const text = (await banner.textContent()) ?? '';
  const match = /Score (\d+)/.exec(text);
  const ceiling = Number(await page.getByTestId('game-shell').getAttribute('data-max-score'));
  const score = match ? Number(match[1]) : -1;

  expect(score).toBeGreaterThanOrEqual(0);
  expect(score, 'a reported score must never exceed game_catalog.max_score').toBeLessThanOrEqual(ceiling);

  return { text, score };
}

/** The `record_game_result()` call, asserting the game reported exactly once. */
function recordedResult(stub: SupabaseStub): Record<string, unknown> {
  const writes = stub.writes.filter((entry) => entry.table === 'rpc/record_game_result');
  expect(writes, 'a finished game must be recorded exactly once').toHaveLength(1);

  const body = writes[0]?.body;
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

/** Canvas coordinates for card `index` on the 4x4 board, scale-aware. */
async function cardPosition(
  page: Page,
  index: number
): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('game-canvas').boundingBox();
  const width = box?.width ?? 320;
  const height = box?.height ?? 320;
  const cellWidth = width / 4;
  const cellHeight = height / 4;

  return {
    x: (index % 4) * cellWidth + cellWidth / 2,
    y: Math.floor(index / 4) * cellHeight + cellHeight / 2,
  };
}

test.describe('§3.3 — the Game Hub', () => {
  test('lists every mini-game and marks the playable ones', async ({ page }) => {
    await openHub(page);

    for (const title of NEW_GAME_TITLES) {
      await expect(page.getByRole('button', { name: `Play ${title}` })).toBeVisible();
    }

    // The two Ludo variants became playable against a bot in M30, so neither
    // carries the SOON badge any more.
    await expect(page.getByRole('button', { name: 'Play Ludo Royale' })).toContainText('PLAY');
    await expect(page.getByRole('button', { name: 'Play Ludo Dash' })).toContainText('PLAY');

    // A playable game must not carry the SOON badge.
    await expect(page.getByRole('button', { name: 'Play Speed Matching' })).toContainText('PLAY');
  });

  test('keeps the previously shipped games playable through the new shell', async ({ page }) => {
    await openHub(page);

    await openGame(page, 'Tic Tac Toe');
    await expect(page.getByTestId('game-timer')).toBeVisible();
    await expect(page.getByTestId('game-restart')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Square 1, empty' })).toBeVisible();
  });

  test('opens the Ludo board with a roll control', async ({ page }) => {
    await openHub(page);
    await openGame(page, 'Ludo Dash');

    await expect(page.getByTestId('ludo')).toHaveAttribute('data-variant', 'dash');
    await expect(page.getByTestId('ludo-roll')).toBeEnabled();
    await expect(page.getByTestId('ludo-token-0-0')).toBeVisible();
  });
});

test.describe('§3.3 — the shared shell chrome', () => {
  test('runs a mm:ss timer, resets the round on restart, and shows no early banner', async ({ page }) => {
    await openHub(page);
    await openGame(page, 'Memory Match');

    await expect(page.getByTestId('game-timer')).toHaveText(/^\d+:\d{2}$/);
    await expect(page.getByTestId('game-outcome')).toHaveCount(0);

    const layout = (await page.getByTestId('memory-match-state').getAttribute('data-layout')) ?? '';
    const cards = layout.split(',').map((value) => Number(value));
    const mismatch = cards.findIndex((symbol, index) => index > 0 && symbol !== cards[0]);

    const canvas = page.getByTestId('game-canvas');
    await canvas.click({ position: await cardPosition(page, 0) });
    await canvas.click({ position: await cardPosition(page, mismatch) });
    await expect(page.getByTestId('memory-match-state')).toHaveAttribute('data-moves', '1');

    await page.getByTestId('game-restart').click();
    await expect(page.getByTestId('memory-match-state')).toHaveAttribute('data-moves', '0');
    await expect(page.getByTestId('game-timer')).toHaveText(/^0:0\d$/);
    await expect(page.getByTestId('game-outcome')).toHaveCount(0);
  });
});

test.describe('§3.3 — memory-match (HTML5 canvas)', () => {
  test('is playable to a scored outcome on a real canvas, without a reload', async ({ page }) => {
    const stub = await openHub(page);
    await openGame(page, 'Memory Match');
    await markNoReload(page);

    // The shell rendered a real canvas, not a div pretending to be one.
    const canvas = page.getByTestId('game-canvas');
    await expect(canvas).toBeVisible();
    expect(await canvas.evaluate((element) => element.tagName)).toBe('CANVAS');

    const layout = (await page.getByTestId('memory-match-state').getAttribute('data-layout')) ?? '';
    const cards = layout.split(',').map((value) => Number(value));
    expect(cards, 'a 4x4 board holds 16 cards').toHaveLength(16);

    const pairs = new Map<number, number[]>();
    cards.forEach((symbol, index) => {
      const bucket = pairs.get(symbol) ?? [];
      bucket.push(index);
      pairs.set(symbol, bucket);
    });
    expect(pairs.size, 'four by four with eight distinct symbols is eight pairs').toBe(8);

    let solved = 0;
    for (const bucket of pairs.values()) {
      expect(bucket).toHaveLength(2);
      for (const index of bucket) {
        await canvas.click({ position: await cardPosition(page, index) });
      }
      solved += 1;
      await expect(page.getByTestId('memory-match-state')).toHaveAttribute('data-pairs', String(solved));
    }

    const outcome = await readOutcome(page);
    expect(outcome.text).toContain('You won!');
    expect(outcome.score, 'a clean eight-move clear must score above zero').toBeGreaterThan(0);

    await assertNoReload(page);

    const recorded = recordedResult(stub);
    expect(recorded.p_game_id).toBe('memory-match');
    expect(recorded.p_outcome).toBe('win');
    expect(recorded.p_score).toBe(outcome.score);
  });
});

test.describe('§3.3 — icebreaker trivia', () => {
  test('answers the fixed bank correctly and scores the ceiling', async ({ page }) => {
    const stub = await openHub(page);
    await openGame(page, 'Icebreaker Trivia');
    await markNoReload(page);

    const options = page.getByTestId('icebreaker-options');

    for (const [step, question] of ICEBREAKER_QUESTIONS.entries()) {
      await expect(page.getByTestId('icebreaker')).toHaveAttribute('data-step', String(step));
      await expect(options.getByRole('button')).toHaveCount(question.options.length);
      await options.getByRole('button').nth(question.answerIndex).click();
      await page.getByTestId('icebreaker-next').click();
    }

    const outcome = await readOutcome(page);
    expect(outcome.text).toBe('You won! Score 50.');
    await assertNoReload(page);

    const recorded = recordedResult(stub);
    expect(recorded.p_game_id).toBe('icebreaker');
    expect(recorded.p_score).toBe(50);
  });
});

test.describe('§3.3 — truth-or-dare', () => {
  test('reveals a whole deck with no repeats and finishes the round', async ({ page }) => {
    const stub = await openHub(page);
    await openGame(page, 'Truth or Dare');
    await markNoReload(page);

    const next = page.getByTestId('truth-or-dare-next');
    const seen = new Set<string>();

    // One extra click past the deck: the last one ends the round.
    for (let turn = 0; turn < TRUTH_OR_DARE_TURNS + 1; turn += 1) {
      const card = page.getByTestId('truth-or-dare-card');
      if (await card.count()) {
        seen.add((await card.textContent()) ?? '');
      }
      await next.click();
    }

    expect(seen.size, 'no prompt may repeat until the deck is exhausted').toBe(TRUTH_OR_DARE_TURNS);

    const outcome = await readOutcome(page);
    expect(outcome.text).toBe('You won! Score 15.');
    await assertNoReload(page);

    const recorded = recordedResult(stub);
    expect(recorded.p_game_id).toBe('truth-or-dare');
    expect(recorded.p_outcome).toBe('win');
  });
});

test.describe('§3.3 — speed-matching', () => {
  test('answers every paired prompt before the clock and scores the ceiling', async ({ page }) => {
    const stub = await openHub(page);
    await openGame(page, 'Speed Matching');
    await markNoReload(page);

    const pairs = speedMatchPairsFor(0);
    await expect(page.getByTestId('speed-clock')).toHaveText(/^\d+:\d{2}$/);

    for (const pair of pairs) {
      await expect(page.getByTestId('speed-prompt')).toHaveText(pair.prompt);
      await page.getByTestId(`speed-option-${pair.partnerIndex}`).click();
    }

    const outcome = await readOutcome(page);
    expect(outcome.text).toBe('You won! Score 80.');
    await assertNoReload(page);

    const recorded = recordedResult(stub);
    expect(recorded.p_game_id).toBe('speed-matching');
    expect(recorded.p_score).toBe(80);
  });
});

test.describe('§3.3 — word-guess', () => {
  test('solves the deterministic round word letter by letter', async ({ page }) => {
    const stub = await openHub(page);
    await openGame(page, 'Word Guessing');
    await markNoReload(page);

    const entry = wordGuessRoundFor(0);
    const unique = [...new Set(entry.word.split(''))];

    for (const letter of unique) {
      await page.getByTestId(`word-guess-letter-${letter}`).click();
    }

    await expect(page.getByTestId('word-guess')).toHaveAttribute('data-wrong', '0');

    const outcome = await readOutcome(page);
    expect(outcome.text).toBe('You won! Score 60.');
    await assertNoReload(page);

    const recorded = recordedResult(stub);
    expect(recorded.p_game_id).toBe('word-guess');
    expect(recorded.p_score).toBe(60);
  });
});

test.describe('§3.3 — twenty-questions', () => {
  test('narrows a hidden answer with truthful yes/no replies', async ({ page }) => {
    const stub = await openHub(page);
    await openGame(page, '20 Questions');
    await markNoReload(page);

    const hidden = twentyQuestionsSubjectFor(0);
    let asked = 0;

    while (asked < TWENTY_QUESTIONS_FEATURES.length) {
      const prompt = page.getByTestId('twenty-questions-prompt');
      if ((await prompt.count()) === 0) break;

      const text = (await prompt.textContent()) ?? '';
      const feature = TWENTY_QUESTIONS_FEATURES.find((entry) => entry.question === text);
      expect(feature, 'every asked question must come from the fixed bank').toBeTruthy();

      const truthful = hidden.features.includes(feature?.id ?? '');
      await page.getByTestId(truthful ? 'twenty-questions-yes' : 'twenty-questions-no').click();
      asked += 1;
    }

    expect(asked, 'the app must actually ask something').toBeGreaterThan(0);
    await expect(page.getByTestId('twenty-questions-guess')).toContainText(hidden.label);
    await page.getByTestId('twenty-questions-guess-yes').click();

    const outcome = await readOutcome(page);
    expect(outcome.text).toContain('You won!');
    await assertNoReload(page);

    const recorded = recordedResult(stub);
    expect(recorded.p_game_id).toBe('twenty-questions');
    expect(recorded.p_outcome).toBe('win');
  });
});

test.describe('§3.3 — spin-the-wheel (sandboxed iframe)', () => {
  test('spins a genuinely sandboxed document until the wheel is exhausted', async ({ page }) => {
    const stub = await openHub(page);
    await openGame(page, 'Spin the Wheel');
    await markNoReload(page);

    const sandbox = page.getByTestId('game-sandbox');
    await expect(sandbox).toBeVisible();
    expect(await sandbox.getAttribute('sandbox')).toBe('allow-scripts');

    // The handshake proves the document's own script ran and can post back.
    await expect(page.getByTestId('spin-wheel-ready')).toContainText('Wheel ready');

    const frame = page.frameLocator('[data-testid="game-sandbox"]');
    for (const [spin] of WHEEL_SEGMENTS.entries()) {
      await frame.getByRole('button', { name: 'SPIN' }).click();
      await expect(page.getByTestId('spin-wheel')).toHaveAttribute('data-spins', String(spin + 1));
    }

    const outcome = await readOutcome(page);
    expect(outcome.text).toBe('You won! Score 20.');
    await assertNoReload(page);

    const recorded = recordedResult(stub);
    expect(recorded.p_game_id).toBe('spin-the-wheel');
    expect(recorded.p_score).toBe(20);
  });
});
