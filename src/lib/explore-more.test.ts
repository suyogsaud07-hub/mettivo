import { describe, expect, it } from 'vitest';
import {
  EXPLORE_CATEGORIES,
  EXPLORE_CATEGORY_IDS,
  EXPLORE_GOALS,
  EXPLORE_GOAL_KEYS,
  exploreGoal,
  isExploreCategoryId,
  isExploreGoalKey,
} from '@/lib/explore-more';
import { PROFILE_INTENTION_OPTIONS } from '@/lib/profile-options';

describe('Explore More category and dating-goal contract', () => {
  it('offers exactly the seven curated categories, each once', () => {
    expect(EXPLORE_CATEGORY_IDS).toHaveLength(7);
    expect(new Set(EXPLORE_CATEGORY_IDS).size).toBe(7);
    expect(EXPLORE_CATEGORIES.map((category) => category.id)).toEqual([
      ...EXPLORE_CATEGORY_IDS,
    ]);
    expect(EXPLORE_CATEGORIES.map((category) => category.title)).toEqual([
      'Dating Goals',
      'Coffee & Food Dates',
      'Nature & Adventure',
      'Gamers & Entertainment',
      'Pet Lovers',
      'Travel Partners',
      'New Friends',
    ]);
  });

  it('keeps Serious Relationship inside Dating Goals, never top level', () => {
    expect(isExploreCategoryId('serious')).toBe(false);
    expect(EXPLORE_CATEGORIES.some((category) => category.title === 'Serious Relationship')).toBe(false);
    expect(EXPLORE_CATEGORIES.find((category) => category.id === 'dating-goals')?.requiresGoal).toBe(true);
  });

  it('has exactly three goals mapped onto the stored intention values', () => {
    expect(EXPLORE_GOAL_KEYS).toEqual(['friendship', 'serious', 'casual']);
    expect(EXPLORE_GOALS.map((goal) => [goal.key, goal.title, goal.intention])).toEqual([
      ['friendship', 'Friendship and Networking', 'friendship'],
      ['serious', 'Serious Relationship', 'dating'],
      ['casual', 'Casual & Open to Options', 'both'],
    ]);
    for (const goal of EXPLORE_GOALS) expect(exploreGoal(goal.key)).toEqual(goal);
  });

  it('uses the same exact labels as the profile editor', () => {
    for (const option of PROFILE_INTENTION_OPTIONS) {
      const goal = EXPLORE_GOALS.find((item) => item.intention === option.value);
      expect(goal?.title).toBe(option.label);
    }
  });

  it('rejects unknown ids instead of silently falling back', () => {
    expect(isExploreGoalKey('serious')).toBe(true);
    expect(isExploreGoalKey('serious-relationship')).toBe(false);
    expect(isExploreCategoryId('dating-goals')).toBe(true);
    expect(isExploreCategoryId('Dating-Goals')).toBe(false);
    expect(isExploreCategoryId(null)).toBe(false);
  });
});
