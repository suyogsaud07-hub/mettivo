"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Card } from "@/app/components/ui/Card";
import { PROMPTS, type UserProfile, type Interest } from "@/app/lib/mockData";

export default function ProfilePage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Omit<UserProfile, "id" | "interests" | "promptAnswers" | "photos" | "online">>({
    name: "",
    age: 18,
    city: "",
    intention: "both",
    about: "",
  });
  const [promptAnswers, setPromptAnswers] = useState<{ [key: string]: string }>({});
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const handleNext = () => {
    if (step === 1 && (!form.name.trim() || !form.city.trim() || form.age < 18)) {
      return;
    }
    if (step === 2 && selectedInterests.length === 0) {
      return;
    }
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    setStep((s) => Math.max(1, s - 1));
  };

  const handleFinish = () => {
    const saved: UserProfile = {
      id: "me",
      ...form,
      promptAnswers: { ...promptAnswers },
      interests: [...selectedInterests],
      photos: ["/next.svg"],
      online: false,
    };
    localStorage.setItem("spark_profile", JSON.stringify(saved));
    // Simulate navigation
    window.location.href = "/discover";
  };

  return (
    <div className="pb-6">
      {/* Stepper */}
      <div className="flex items-center justify-center gap-4 py-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${
                step >= s
                  ? "bg-rose-500 text-white"
                  : "bg-neutral-200 dark:bg-neutral-800 text-neutral-500"
              }`}
            >
              {s}
            </div>
            {s < 3 && (
              <div
                className={`w-12 h-0.5 transition-colors ${
                  step > s ? "bg-rose-500" : "bg-neutral-200 dark:bg-neutral-800"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="px-4 space-y-4">
        {step === 1 && (
          <Card variant="elevated">
            <div className="p-5 space-y-4">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Tell us about yourself
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Name"
                  placeholder="Your name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
                <Input
                  label="Age"
                  type="number"
                  placeholder="Age"
                  min={18}
                  max={99}
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: parseInt(e.target.value) || 18 })}
                />
              </div>
              <Input
                label="City"
                placeholder="Your city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                required
              />
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Short bio (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                  placeholder="A few words about yourself..."
                  value={form.about}
                  onChange={(e) => setForm({ ...form, about: e.target.value })}
                />
              </div>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card variant="elevated">
            <div className="p-5 space-y-5">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                What are you looking for?
              </h2>
              <div className="space-y-2">
                {[
                  { value: "friendship", label: "Friendship" },
                  { value: "dating", label: "Dating" },
                  { value: "both", label: "Both (Friends + Dating)" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                      form.intention === opt.value
                        ? "border-rose-500 bg-rose-500/10"
                        : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="intention"
                      value={opt.value}
                      checked={form.intention === opt.value}
                      onChange={(e) => setForm({ ...form, intention: e.target.value as any })}
                      className="h-5 w-5 text-rose-500 focus:ring-rose-500"
                    />
                    <span className="text-neutral-900 dark:text-neutral-100">{opt.label}</span>
                  </label>
                ))}
              </div>

              <div>
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                  Choose your interests (pick at least one):
                </p>
                <div className="flex flex-wrap gap-2">
                  {PROMPTS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        const idx = selectedInterests.indexOf(p.id);
                        if (idx > -1) setSelectedInterests(selectedInterests.filter((_, i) => i !== idx));
                        else setSelectedInterests([...selectedInterests, p.id]);
                      }}
                      className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        selectedInterests.includes(p.id)
                          ? "bg-rose-500 border-rose-500 text-white"
                          : "bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300"
                      }`}
                    >
                      {p.question.split("...")[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card variant="elevated">
            <div className="p-5 space-y-5">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Answer 3 quick prompts
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-500">
                These help matches see your personality.
              </p>
              {PROMPTS.map((prompt) => (
                <div key={prompt.id} className="space-y-2">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-200">
                    {prompt.question}
                  </p>
                  <textarea
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                    placeholder={prompt.placeholder}
                    value={promptAnswers[prompt.id] || ""}
                    onChange={(e) =>
                      setPromptAnswers({ ...promptAnswers, [prompt.id]: e.target.value })
                    }
                  />
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="flex gap-3 pt-2">
          {step > 1 ? (
            <Button variant="ghost" onClick={handleBack} className="flex-1">
              Back
            </Button>
          ) : (
            <div className="w-[calc(50%-6px)]" />
          )}

          {step < 3 ? (
            <Button variant="primary" onClick={handleNext} className="flex-1">
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={handleFinish} className="flex-1">
              Complete profile
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
