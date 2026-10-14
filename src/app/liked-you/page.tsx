'use client';

export default function LikedYouPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 pb-28 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 bg-rose-500/20 text-rose-500 rounded-full flex items-center justify-center text-3xl mb-4 shadow-lg">
        🤍
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">See who liked you</h1>
      <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">
        Upgrade to Spark Premium to see everyone who's already swiped right on your profile!
      </p>
    </div>
  );
}