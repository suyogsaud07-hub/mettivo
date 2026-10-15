/**
 * Fixed content banks and deterministic per-round selection for the Game Zone
 * mini-games.
 *
 * This module is deliberately free of React, of `next/*` and of every other
 * import except the pure helpers in `./deterministic`, so the Playwright
 * journeys can import it directly and compute the exact board, deck or answer a
 * round will use. No network, no CDN, no random source: every bank is a literal
 * and every selection is a function of the round number.
 */

import { pickWithSeed, shuffleWithSeed } from './deterministic';

/* -------------------------------------------------------------------------- */
/* Icebreaker Trivia                                                          */
/* -------------------------------------------------------------------------- */

export interface TriviaQuestion {
  id: string;
  prompt: string;
  /** Exactly four options; `answerIndex` points at the correct one. */
  options: readonly string[];
  answerIndex: number;
}

export const ICEBREAKER_QUESTIONS: readonly TriviaQuestion[] = [
  {
    id: 'city-of-lakes',
    prompt: 'Which Nepali city is known as the City of Lakes?',
    options: ['Kathmandu', 'Pokhara', 'Biratnagar', 'Nepalgunj'],
    answerIndex: 1,
  },
  {
    id: 'festival-of-lights',
    prompt: 'Which festival is Nepal’s festival of lights?',
    options: ['Dashain', 'Holi', 'Tihar', 'Teej'],
    answerIndex: 2,
  },
  {
    id: 'national-flower',
    prompt: 'What is Nepal’s national flower?',
    options: ['Lotus', 'Rhododendron', 'Marigold', 'Sunflower'],
    answerIndex: 1,
  },
  {
    id: 'everest-name',
    prompt: 'What is Mount Everest called in Nepali?',
    options: ['Annapurna', 'Sagarmatha', 'Machhapuchhre', 'Langtang'],
    answerIndex: 1,
  },
  {
    id: 'milk-tea',
    prompt: 'Which drink is Nepal’s everyday spiced milk tea?',
    options: ['Lassi', 'Thandai', 'Chiya', 'Buttermilk'],
    answerIndex: 2,
  },
  {
    id: 'namaste',
    prompt: 'What does “Namaste” literally mean?',
    options: ['Good morning', 'I bow to you', 'Thank you', 'See you later'],
    answerIndex: 1,
  },
];

/** Score awarded for a perfect round; mirrors `game_catalog.max_score`. */
export const ICEBREAKER_MAX_SCORE = 50;

/* -------------------------------------------------------------------------- */
/* Word Guessing                                                              */
/* -------------------------------------------------------------------------- */

export interface GuessWord {
  word: string;
  hint: string;
}

export const WORD_GUESS_WORDS: readonly GuessWord[] = [
  { word: 'HIMALAYA', hint: 'The range that gives Nepal its skyline' },
  { word: 'MOMO', hint: 'Steamed dumplings, a Nepali favourite' },
  { word: 'SARANGI', hint: 'A bowed Nepali folk instrument' },
  { word: 'DASHAIN', hint: 'Nepal’s biggest autumn festival' },
  { word: 'EVEREST', hint: 'The highest point on Earth' },
  { word: 'POKHARA', hint: 'Lakeside city under the Annapurnas' },
  { word: 'CHIYA', hint: 'Sweet spiced milk tea' },
  { word: 'LUMBINI', hint: 'Birthplace of the Buddha' },
  { word: 'ANNAPURNA', hint: 'A famous trekking circuit' },
  { word: 'KHUKURI', hint: 'The curved Gurkha blade' },
];

/** Wrong guesses allowed before the round is lost. */
export const WORD_GUESS_MAX_WRONG = 6;
/** Score lost per wrong guess; a clean round scores the full ceiling. */
export const WORD_GUESS_PENALTY = 10;
export const WORD_GUESS_MAX_SCORE = 60;

export function wordGuessRoundFor(round: number): GuessWord {
  return shuffleWithSeed(WORD_GUESS_WORDS, round + 1)[0];
}

/* -------------------------------------------------------------------------- */
/* Truth or Dare                                                              */
/* -------------------------------------------------------------------------- */

export type PromptKind = 'truth' | 'dare';

export interface PromptCard {
  id: string;
  kind: PromptKind;
  text: string;
}

export const TRUTH_OR_DARE_DECK: readonly PromptCard[] = [
  { id: 't1', kind: 'truth', text: 'What is the most romantic thing anyone has done for you?' },
  { id: 'd1', kind: 'dare', text: 'Describe your perfect first date in exactly ten words.' },
  { id: 't2', kind: 'truth', text: 'What is one thing you would love someone to ask you about?' },
  { id: 'd2', kind: 'dare', text: 'Send a voice note humming one line of your favourite song.' },
  { id: 't3', kind: 'truth', text: 'What is your most unreasonable deal-breaker?' },
  { id: 'd3', kind: 'dare', text: 'Show your best impression of a Nepali mum answering the phone.' },
  { id: 't4', kind: 'truth', text: 'When did you last change your mind about something important?' },
  { id: 'd4', kind: 'dare', text: 'Text the last emoji you used, with no explanation.' },
  { id: 't5', kind: 'truth', text: 'What does home mean to you?' },
  { id: 'd5', kind: 'dare', text: 'Give a thirty-second review of the last meal you cooked.' },
  { id: 't6', kind: 'truth', text: 'What is something you are proud of that nobody knows about?' },
  { id: 'd6', kind: 'dare', text: 'Pick a song that describes your week and say why in one sentence.' },
];

/** Cards revealed per game; the shuffled deck holds far more, so no repeats. */
export const TRUTH_OR_DARE_TURNS = 6;
export const TRUTH_OR_DARE_MAX_SCORE = 15;

/** A shuffled deck — every game consumes it in order, never repeating a card. */
export function truthOrDareDeckFor(round: number): PromptCard[] {
  return shuffleWithSeed(TRUTH_OR_DARE_DECK, 500 + round);
}

/* -------------------------------------------------------------------------- */
/* 20 Questions                                                               */
/* -------------------------------------------------------------------------- */

export interface TwentyQuestionsFeature {
  id: string;
  question: string;
}

export interface TwentyQuestionsSubject {
  id: string;
  label: string;
  /** Ids of the features that are TRUE for this subject. */
  features: readonly string[];
}

export const TWENTY_QUESTIONS_FEATURES: readonly TwentyQuestionsFeature[] = [
  { id: 'edible', question: 'Is it something you can eat or drink?' },
  { id: 'sweet', question: 'Is it sweet?' },
  { id: 'place', question: 'Is it a place you could visit?' },
  { id: 'social', question: 'Is it something people do together?' },
  { id: 'object', question: 'Is it a physical object somebody made?' },
  { id: 'nature', question: 'Would you find it outdoors in nature?' },
];

/**
 * The hidden answers. Every feature vector below is distinct, so truthful
 * answers always narrow the field to exactly one subject.
 */
export const TWENTY_QUESTIONS_SUBJECTS: readonly TwentyQuestionsSubject[] = [
  { id: 'momo', label: 'Momo', features: ['edible', 'social'] },
  { id: 'chiya', label: 'Chiya', features: ['edible', 'sweet', 'social'] },
  { id: 'pokhara', label: 'Pokhara', features: ['place', 'nature'] },
  { id: 'sarangi', label: 'The sarangi', features: ['object'] },
  { id: 'dashain', label: 'Dashain', features: ['social'] },
  { id: 'everest', label: 'Mount Everest', features: ['nature'] },
];

/** The app guesses once the field is this small or the features run out. */
export const TWENTY_QUESTIONS_MAX_ASKS = TWENTY_QUESTIONS_FEATURES.length;
export const TWENTY_QUESTIONS_MAX_SCORE = 30;
/** Score lost for each question beyond the first. */
export const TWENTY_QUESTIONS_PENALTY = 5;

export function twentyQuestionsSubjectFor(round: number): TwentyQuestionsSubject {
  return pickWithSeed(TWENTY_QUESTIONS_SUBJECTS, round);
}

/* -------------------------------------------------------------------------- */
/* Speed Matching                                                             */
/* -------------------------------------------------------------------------- */

export interface SpeedPair {
  id: string;
  prompt: string;
  options: readonly [string, string];
  /** Which option the partner picked; choosing it counts as a match. */
  partnerIndex: 0 | 1;
}

export const SPEED_MATCH_PAIRS: readonly SpeedPair[] = [
  { id: 's1', prompt: 'Mountains or beaches?', options: ['Mountains', 'Beaches'], partnerIndex: 0 },
  { id: 's2', prompt: 'Morning person or night owl?', options: ['Morning person', 'Night owl'], partnerIndex: 1 },
  { id: 's3', prompt: 'Chiya or coffee?', options: ['Chiya', 'Coffee'], partnerIndex: 0 },
  { id: 's4', prompt: 'Momo or pizza?', options: ['Momo', 'Pizza'], partnerIndex: 0 },
  { id: 's5', prompt: 'Text or call?', options: ['Text', 'Call'], partnerIndex: 1 },
  { id: 's6', prompt: 'Movie night in or live gig?', options: ['Movie night in', 'Live gig'], partnerIndex: 1 },
  { id: 's7', prompt: 'Trekking or road trip?', options: ['Trekking', 'Road trip'], partnerIndex: 0 },
  { id: 's8', prompt: 'Cats or dogs?', options: ['Cats', 'Dogs'], partnerIndex: 1 },
  { id: 's9', prompt: 'Plan everything or wing it?', options: ['Plan everything', 'Wing it'], partnerIndex: 1 },
  { id: 's10', prompt: 'Deep talk or silly jokes?', options: ['Deep talk', 'Silly jokes'], partnerIndex: 0 },
];

export const SPEED_MATCH_SECONDS = 45;
export const SPEED_MATCH_POINTS_PER_MATCH = 8;
export const SPEED_MATCH_MAX_SCORE = 80;

/** Pair order for a round — a seeded shuffle, so it varies but never repeats. */
export function speedMatchPairsFor(round: number): SpeedPair[] {
  return shuffleWithSeed(SPEED_MATCH_PAIRS, 900 + round);
}

/* -------------------------------------------------------------------------- */
/* Spin the Wheel                                                             */
/* -------------------------------------------------------------------------- */

export interface WheelSegment {
  id: string;
  label: string;
}

export const WHEEL_SEGMENTS: readonly WheelSegment[] = [
  { id: 'w1', label: 'Street momo crawl' },
  { id: 'w2', label: 'Sunset at the lake' },
  { id: 'w3', label: 'Coffee and people-watching' },
  { id: 'w4', label: 'Live acoustic gig' },
  { id: 'w5', label: 'Bookshop and chiya' },
  { id: 'w6', label: 'Day hike and a picnic' },
];

/**
 * Spin order baked into the sandboxed document. A fixed permutation of the
 * segment indices, so the wheel covers every segment once before repeating —
 * "no repeats until the deck is exhausted" without a random source.
 */
export const WHEEL_SPIN_ORDER: readonly number[] = [3, 0, 5, 1, 4, 2];
export const WHEEL_MAX_SCORE = 20;
