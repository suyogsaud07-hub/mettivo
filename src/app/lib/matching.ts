import { type UserProfile, INTERESTS, PROMPTS } from "@/app/lib/mockData";

/**
 * Simple rule-based matching engine for the MVP.
 * Returns a score 0-1 for how well two profiles match.
 */
export function matchScore(userA: UserProfile, userB: UserProfile): number {
  let score = 0;

  // 1. Intention compatibility (0-40 points)
  const intentionMap: Record<string, Set<string>> = {
    friendship: new Set(["friendship", "both"]),
    dating: new Set(["dating", "both"]),
    both: new Set(["friendship", "dating", "both"]),
  };

  const aIntent = intentionMap[userA.intention] ?? new Set();
  const bIntent = intentionMap[userB.intention] ?? new Set();

  if (aIntent.has(userB.intention) && bIntent.has(userA.intention)) {
    score += 40; // Mutual match
  } else if (aIntent.has(userB.intention) || bIntent.has(userA.intention)) {
    score += 20; // One-way match
  }

  // 2. Interest overlap (0-30 points)
  const aInterests = new Set(userA.interests);
  const bInterests = new Set(userB.interests);
  const commonInterests = [...aInterests].filter((i) => bInterests.has(i));
  const interestScore =
    (commonInterests.length / Math.max(aInterests.size, bInterests.size)) * 30;
  score += interestScore;

  // 3. Prompt affinity (0-30 points) - simple keyword matching
  let promptMatches = 0;
  let totalPrompts = 0;

  for (const prompt of PROMPTS) {
    const answerA = userA.promptAnswers[prompt.id]?.toLowerCase() ?? "";
    const answerB = userB.promptAnswers[prompt.id]?.toLowerCase() ?? "";

    if (answerA && answerB) {
      totalPrompts++;
      // Very simple: check for common words (3+ chars)
      const wordsA = answerA
        .split(/\W+/)
        .filter((w) => w.length > 2)
        .map((w) => w.toLowerCase());
      const wordsB = answerB
        .split(/\W+/)
        .filter((w) => w.length > 2)
        .map((w) => w.toLowerCase());

      const commonWords = wordsA.filter((w) => wordsB.includes(w));
      if (commonWords.length > 0) promptMatches++;
    }
  }

  const promptScore = (promptMatches / Math.max(totalPrompts, 1)) * 30;
  score += promptScore;

  return Math.min(score, 100); // Cap at 100
}

/**
 * Get ranked matches for a user from the mock pool.
 */
export function getMatchesForUser(
  user: UserProfile,
  pool: UserProfile[],
  limit = 10
): { profile: UserProfile; score: number }[] {
  return pool
    .filter((p) => p.id !== user.id)
    .map((profile) => ({
      profile,
      score: matchScore(user, profile),
    }))
    .filter(({ score }) => score > 30) // Minimum threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}