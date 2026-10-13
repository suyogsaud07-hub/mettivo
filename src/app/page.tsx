import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-col min-h-full">
      {/* Decorative background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full bg-rose-500/10 blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[60%] h-[60%] rounded-full bg-purple-500/10 blur-[120px]" />
      </div>

      <div className="flex flex-col flex-1 items-center justify-between py-12 px-6 max-w-md mx-auto">
        {/* Top: logo + tagline */}
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-rose-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-rose-500/30 mb-4">
            <span className="text-5xl">✨</span>
          </div>

          <div className="flex flex-col gap-3">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              Discover real{" "}
              <span className="bg-gradient-to-r from-rose-500 to-purple-600 bg-clip-text text-transparent">
                connections
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-neutral-600 dark:text-neutral-400 max-w-xs">
              Find friends or dates who share your vibe — through the interests and moments that matter.
            </p>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-sm mt-4">
            <Link
              href="/auth"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-rose-500 to-purple-600 px-6 text-white font-medium text-lg shadow-lg shadow-rose-500/30 hover:opacity-90 transition-opacity"
            >
              Get started
              <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <Link
              href="/auth"
              className="flex h-14 w-full items-center justify-center rounded-full border-2 border-neutral-300 dark:border-neutral-700 px-6 text-neutral-700 dark:text-neutral-300 font-medium text-lg hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
            >
              Log in
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="w-full mt-16 space-y-4">
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-500 uppercase tracking-wider text-center">
            How it works
          </p>
          <div className="space-y-3">
            {[
              { emoji: "👤", title: "Set up your profile", desc: "Share who you are with 3 short prompts." },
              { emoji: "❤️", title: "Discover matches", desc: "Get suggested by shared interests and intent." },
              { emoji: "💬", title: "Chat & connect", desc: "Real conversations, no ghosting (probably)." },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm">
                <span className="text-2xl">{item.emoji}</span>
                <div>
                  <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-neutral-500 dark:text-neutral-500 text-center mt-8">
          Must be 18+ to create an account. By continuing you agree to our Terms.
        </p>
      </div>
    </div>
  );
}
