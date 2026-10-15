import { describe, expect, it } from 'vitest';
import {
  MAX_HOBBIES,
  MAX_INTERESTS,
  MAX_PROMPT_ANSWER_LENGTH,
  groupInterestsByCategory,
  normalizeInterestIds,
  normalizeLabels,
  validateInterestsAndPrompts,
  validatePromptAnswers,
  type Catalogue,
} from '@/lib/catalogue';

/**
 * M8 — interest & prompt catalogue boundary.
 *
 * The failure this prevents is subtle and expensive: if a profile stores an
 * interest id that no other member can hold, the recommendation engine can
 * never award the overlap points, so that profile is silently ranked last
 * forever with no error anywhere.
 */

const catalogue: Catalogue = {
  categories: [
    { id: 'outdoors', label: 'Outdoors', icon: '🏔️', sortOrder: 10 },
    { id: 'food', label: 'Food & Drink', icon: '🍜', sortOrder: 20 },
  ],
  interests: [
    { id: 'hiking', categoryId: 'outdoors', label: 'Hiking', sortOrder: 10 },
    { id: 'travel', categoryId: 'outdoors', label: 'Travel', sortOrder: 20 },
    { id: 'cooking', categoryId: 'food', label: 'Cooking', sortOrder: 10 },
  ],
  prompts: [
    {
      id: 'simple-pleasures',
      category: 'about-me',
      question: 'The simple pleasures I enjoy are…',
      hint: null,
      sortOrder: 10,
    },
    {
      id: 'perfect-weekend',
      category: 'about-me',
      question: 'My perfect weekend looks like…',
      hint: null,
      sortOrder: 20,
    },
  ],
};

describe('M8 — interest catalogue', () => {
  it('groups interests under their category, dropping empty groups', () => {
    const groups = groupInterestsByCategory(catalogue);
    expect(groups.map((group) => group.category.id)).toEqual(['outdoors', 'food']);
    expect(groups[0].interests.map((interest) => interest.id)).toEqual(['hiking', 'travel']);
  });

  it('drops interests the catalogue does not know about', () => {
    expect(normalizeInterestIds(['hiking', 'not-a-real-interest'], catalogue)).toEqual(['hiking']);
  });

  it('de-duplicates and preserves catalogue order of first appearance', () => {
    expect(normalizeInterestIds(['travel', 'hiking', 'travel'], catalogue)).toEqual([
      'travel',
      'hiking',
    ]);
  });

  it('caps the number of interests', () => {
    const many = Array.from({ length: MAX_INTERESTS + 5 }, () => 'hiking');
    expect(normalizeInterestIds(many, catalogue).length).toBeLessThanOrEqual(MAX_INTERESTS);
  });

  it('normalises free-text labels: trims, de-duplicates case-insensitively, caps', () => {
    expect(normalizeLabels([' Music ', 'music', '', 'Travel'], 10)).toEqual(['Music', 'Travel']);
    expect(normalizeLabels(Array.from({ length: 30 }, (_, i) => `h${i}`), MAX_HOBBIES).length).toBe(
      MAX_HOBBIES
    );
  });
});

describe('M8 — prompt answers', () => {
  it('keeps known prompt ids and drops unknown ones', () => {
    const result = validatePromptAnswers(
      { 'simple-pleasures': 'coffee', 'not-a-prompt': 'x' },
      catalogue
    );
    expect(Object.keys(result.answers)).toEqual(['simple-pleasures']);
    expect(result.problems).toEqual([]);
  });

  it('drops blank answers rather than storing whitespace', () => {
    expect(validatePromptAnswers({ 'simple-pleasures': '   ' }, catalogue).answers).toEqual({});
  });

  it('reports an over-long answer instead of silently truncating it', () => {
    const result = validatePromptAnswers(
      { 'simple-pleasures': 'x'.repeat(MAX_PROMPT_ANSWER_LENGTH + 1) },
      catalogue
    );
    expect(result.problems.length).toBe(1);
    expect(result.answers).toEqual({});
  });
});

describe('M8 — combined validation', () => {
  it('returns cleaned values and no problems for valid input', () => {
    const result = validateInterestsAndPrompts(
      {
        interests: ['hiking', 'cooking'],
        hobbies: ['Music', 'music'],
        prompts: { 'simple-pleasures': 'Coffee at sunrise' },
      },
      catalogue
    );
    expect(result.problems).toEqual([]);
    expect(result.cleaned.interests).toEqual(['hiking', 'cooking']);
    expect(result.cleaned.hobbies).toEqual(['Music']);
    expect(result.cleaned.prompts).toEqual({ 'simple-pleasures': 'Coffee at sunrise' });
  });

  it('reports when every selected interest was unrecognised', () => {
    const result = validateInterestsAndPrompts(
      { interests: ['ghost-1', 'ghost-2'], hobbies: [], prompts: {} },
      catalogue
    );
    expect(result.problems.map((problem) => problem.field)).toContain('interests');
  });

  it('is silent when the member simply selected nothing', () => {
    // Choosing no interests is a legitimate choice, not a validation error.
    const result = validateInterestsAndPrompts(
      { interests: [], hobbies: [], prompts: {} },
      catalogue
    );
    expect(result.problems).toEqual([]);
  });
});
