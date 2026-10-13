"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Card } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ageVerified, setAgeVerified] = useState(false);

  const handleAuth = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    // Demo: store a session flag in localStorage for preview purposes.
    localStorage.setItem("spark_logged_in", "true");
    router.push("/discover");
  };

  return (
    <div className="flex flex-col min-h-full">
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full bg-rose-500/10 blur-[120px]" />
        <div className="absolute bottom-[10%] -right-[10%] w-[60%] h-[60%] rounded-full bg-purple-500/10 blur-[120px]" />
      </div>

      <div className="flex flex-col flex-1 items-center justify-center py-8 px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-purple-600 shadow-xl shadow-rose-500/30 mb-4">
            <span className="text-3xl">✨</span>
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Welcome to Spark
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-2">
            The social discovery app for real connections.
          </p>
        </div>

        <div className="w-full max-w-sm space-y-6">
          {/* 18+ eligibility declaration — always shown */}
          <Card variant="elevated">
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <input
                  id="age-verify"
                  type="checkbox"
                  checked={ageVerified}
                  onChange={(e) => setAgeVerified(e.target.checked)}
                  className="mt-0.5 h-5 w-5 rounded border-neutral-300 text-rose-500 focus:ring-rose-500"
                />
                <label htmlFor="age-verify" className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
                  I confirm that I am at least{" "}
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">18 years old</span>{" "}
                  and eligible to view adult-oriented social content in my jurisdiction.
                </label>
              </div>
            </div>
          </Card>

          {/* Auth form */}
          <Card variant="elevated">
            <div className="p-5">
              <div className="flex items-center justify-center gap-2 mb-6">
                <button
                  onClick={() => setIsLogin(true)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                    isLogin
                      ? "bg-rose-500 text-white"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  Log in
                </button>
                <button
                  onClick={() => setIsLogin(false)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                    !isLogin
                      ? "bg-rose-500 text-white"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  Sign up
                </button>
              </div>

              <form onSubmit={handleAuth} className="space-y-4">
                <Input
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  label="Password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {!isLogin && (
                  <Input
                    label="Confirm password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                )}

                {isLogin && (
                  <div className="flex justify-end">
                    <button type="button" className="text-sm font-medium text-rose-500 hover:text-rose-600">
                      Forgot password?
                    </button>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={!ageVerified || !email || !password || (!isLogin && password !== confirmPassword)}
                >
                  {isLogin ? "Log in" : "Create account"}
                </Button>
              </form>
            </div>
          </Card>

          <p className="text-xs text-center text-neutral-500 dark:text-neutral-500">
            By continuing, you agree to our{" "}
            <a href="#" className="text-rose-500 hover:underline">Terms of Service</a> and{" "}
            <a href="#" className="text-rose-500 hover:underline">Privacy Policy</a>.
          </p>

          <Link href="/" className="flex items-center justify-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
            <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
