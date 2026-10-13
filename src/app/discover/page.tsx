"use client";

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/app/components/ui/Button";
import { Card } from "@/app/components/ui/Card";
import { Avatar } from "@/app/components/ui/Avatar";
import { Badge } from "@/app/components/ui/Badge";
import { type UserProfile, type Interest, type Prompt } from "@/app/lib/mockData";
import { getMatchesForUser } from "@/app/lib/matching";

export default function DiscoverPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [matches, setMatches] = useState<Array<{ profile: UserProfile; score: number }>>([]);
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [passed, setPassed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const saved = localStorage.getItem("spark_profile");
    if (saved) {
      setProfile(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    if (profile) {
      // Import mock data directly for ESM compatibility
      const mockDataPromise = import("@/app/lib/mockData");
      mockDataPromise.then(({ MOCK_USERS, INTERESTS, PROMPTS }) => {
        const allMatches = getMatchesForUser(profile, MOCK_USERS);
        setMatches(allMatches);
        setIndex(0);
        // Store for later use in rendering
        // We'll use closures or move data to state if needed
      });
    }
  }, [profile]);

  // Helper to get mock data for rendering (will be undefined until loaded)
  const getMockData = async () => {
    const { MOCK_USERS, INTERESTS, PROMPTS } = await import("@/app/lib/mockData");
    return { MOCK_USERS, INTERESTS, PROMPTS };
  };

  const currentMatch = matches[index];
  const hasActed = liked[currentMatch?.profile.id ?? ""] || passed[currentMatch?.profile.id ?? ""];

  if (!profile) {
    return (
      <div className="flex flex-col min-h-full items-center justify-center py-12">
        <p className="text-center text-neutral-500 dark:text-neutral-500">
          Please complete your profile to see matches.
        </p>
        <Button
          variant="primary"
          onClick={() => window.location.href = "/profile"}
          className="mt-4"
        >
          Go to profile
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="flex-1 overflow-hidden">
        {matches.length === 0 ? (
          <div className="flex flex-col min-h-full items-center justify-center py-12">
            <div className="w-24 h-24 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <span className="text-2xl">❤️</span>
            </div>
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
              No matches yet
            </h2>
            <p className="text-neutral-500 dark:text-neutral-500 text-center max-w-md">
              Try adjusting your profile or interests to discover more people nearby.
            </p>
            <Button
              variant="outline"
              onClick={() => window.location.href = "/profile"}
              className="mt-6"
            >
              Edit profile
            </Button>
          </div>
        ) : (
          <div className="relative">
            {/* Match card */}
            <Card variant="elevated" className="w-full max-w-md mx-auto my-12">
              <div className="relative p-6">
                {/* Photo */}
                <div className="relative aspect-[3/4] w-full rounded-2xl overflow-hidden mb-4">
                  <Avatar
                    src={currentMatch.profile.photos?.[0]}
                    alt={currentMatch.profile.name}
                    fallback={currentMatch.profile.name}
                    size="xl"
                  />
                </div>

                {/* Info - we'll load mock data on render for simplicity in this MVP */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                      {currentMatch.profile.name}
                    </h2>
                    <span className="text-sm text-neutral-500 dark:text-neutral-500">
                      {currentMatch.profile.age}, {currentMatch.profile.city}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    {currentMatch.profile.interests.map((interestId) => {
                      // For demo: map interest IDs to labels (hardcoded for MVP)
                      const interestMap: Record<string, string> = {
                        travel: "Travel",
                        food: "Foodie",
                        music: "Music",
                        hiking: "Hiking",
                        movies: "Movies",
                        fitness: "Fitness",
                        art: "Art",
                        gaming: "Gaming",
                        dogs: "Dogs",
                        coffee: "Coffee",
                        photography: "Photography",
                        yoga: "Yoga",
                      };
                      return (
                        <Badge
                          key={interestId}
                          variant="secondary"
                          size="sm"
                        >
                          {interestMap[interestId] || interestId}
                        </Badge>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    {/* Prompt answers - we'll show placeholder if not loaded */}
                    {Object.entries(currentMatch.profile.promptAnswers || {}).map(
                      ([promptId, answer]) => {
                        if (!answer) return null;
                        // Map prompt IDs to questions (hardcoded for MVP)
                        const promptMap: Record<string, string> = {
                          "simple-pleasures": "My simple pleasures are...",
                          "geek-out": "I geek out on...",
                          "together": "Together, we could...",
                        };
                        return (
                          <div key={promptId} className="text-sm">
                            <p className="font-medium text-neutral-700 dark:text-neutral-300">
                              {promptMap[promptId] || promptId}
                            </p>
                            <p className="text-neutral-900 dark:text-neutral-100">{answer}</p>
                          </div>
                        );
                      }
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-neutral-200 dark:border-neutral-800">
                    <span className="text-sm font-medium text-neutral-500 dark:text-neutral-500">
                      Match score: {Math.round(currentMatch.score)}%
                    </span>
                    <div className="flex gap-2">
                      {hasActed ? (
                        <>
                          <Button variant="ghost" size="sm" disabled>
                            {liked[currentMatch.profile.id] ? "Liked" : "Passed"}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setPassed((prev) => ({ ...prev, [currentMatch.profile.id]: true }));
                              setIndex((prev) => (prev + 1 < matches.length ? prev + 1 : 0));
                            }}
                            className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                          >
                            Pass
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setLiked((prev) => ({ ...prev, [currentMatch.profile.id]: true }));
                              setIndex((prev) => (prev + 1 < matches.length ? prev + 1 : 0));
                            }}
                          >
                            Like
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Progress dots */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1">
              {matches.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    i === index
                      ? "bg-rose-500"
                      : "bg-neutral-200 dark:bg-neutral-800"
                  }`}
                />
              ))}
            </div>

            {/* Instructions overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-neutral-900 dark:text-neutral-100 text-sm">
                Swipe left to pass, right to like{' '}
                <span className="ml-1 text-xs">
                  (or use buttons below)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
