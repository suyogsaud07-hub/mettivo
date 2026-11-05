'use client';

export default function DiscoveryCardSkeleton() {
  return (
    <div className="w-full max-w-md mx-auto animate-pulse">
      {/* Photo area */}
      <div className="w-full aspect-video bg-[#211A28] border border-[#34283F]/40 rounded-3xl overflow-hidden relative">
        <div className="absolute inset-0 bg-[#17121A]/60" />
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-[#211A28]/90 to-transparent" />
      </div>

      <div className="mt-6 px-6 space-y-4">
        {/* Name row */}
        <div className="flex items-center gap-2">
          <div className="h-7 w-32 bg-[#17121A] rounded-full" />
          <div className="h-7 w-16 bg-[#17121A] rounded-full" />
          <div className="ml-auto h-6 w-12 bg-[#17121A] rounded-full" />
        </div>

        {/* Casual intent */}
        <div className="h-8 w-32 bg-[#17121A] rounded-full" />

        {/* Bio preview */}
        <div className="space-y-2">
          <div className="h-4 w-4/5 bg-[#17121A] rounded-full" />
          <div className="h-4 w-3/5 bg-[#17121A] rounded-full" />
        </div>

        {/* Interest chips */}
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 px-3 bg-[#17121A] rounded-full border border-[#34283F]/40" />
          ))}
        </div>

        {/* Intention */}
        <div className="h-8 w-32 bg-[#17121A] rounded-full" />
      </div>
    </div>
  );
}
