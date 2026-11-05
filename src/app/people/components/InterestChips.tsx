'use client';

interface InterestChipsProps {
  interests: string[];
  maxVisible?: number;
}

export default function InterestChips({
  interests,
  maxVisible = 6,
}: InterestChipsProps) {
  const visible = interests.slice(0, maxVisible);
  const hidden = interests.length > maxVisible;

  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((interest) => (
        <span
          key={interest}
          className="rounded-full border border-[#34283F]/60 bg-[#17121A]/60 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-[#B58A83] capitalize"
          aria-label={interest}
        >
          {interest}
        </span>
      ))}
      {hidden && (
        <span
          className="rounded-full border border-[#34283F]/60 bg-[#17121A]/60 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-[#D9B38C]"
        >
          +{interests.length - maxVisible}
        </span>
      )}
    </div>
  );
}
