'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CASUAL_INTENTS, type CasualIntent } from '@/lib/casual-intent';

/**
 * Casual Intent Category Cards
 *
 * Renders three cards for casual dating intents:
 * - Free Tonight
 * - Short Term Fun
 * - Friends with Benefits
 *
 * Matches the Midnight Romance theme with deep purples and golds.
 */

interface CasualIntentCardsProps {
  /** Currently selected casual intent filter */
  selectedIntent: CasualIntent | null;
  /** Callback when a casual intent is selected */
  onSelect: (intent: CasualIntent | null) => void;
  /** Whether to show as compact chips or full cards */
  variant?: 'cards' | 'chips';
}

export default function CasualIntentCards({
  selectedIntent,
  onSelect,
  variant = 'cards',
}: CasualIntentCardsProps) {
  const router = useRouter();
  const [hoveredIntent, setHoveredIntent] = useState<CasualIntent | null>(null);

  const handleSelect = useCallback((
    intent: CasualIntent | null
  ) => {
    onSelect(intent);
  }, [onSelect]);

  const handleCardClick = useCallback((
    intent: CasualIntent
  ) => {
    // If clicking a card, navigate to explore with that filter
    router.push(`/explore?intent=${intent}`);
  }, [router]);

  if (variant === 'chips') {
    return (
      <div className="flex gap-2 flex-wrap">
        {CASUAL_INTENTS.map((intent) => {
          const isSelected = selectedIntent === intent.id;
          const isHovered = hoveredIntent === intent.id;

          return (
            <button
              key={intent.id}
              type="button"
              onClick={() => handleSelect(isSelected ? null : intent.id)}
              onMouseEnter={() => setHoveredIntent(intent.id)}
              onMouseLeave={() => setHoveredIntent(null)}
              className={`
                px-4 py-2 rounded-full text-sm font-semibold transition-all
                ${isSelected
                  ? 'bg-[#D4B18A] text-[#17121C] shadow-lg shadow-[#D4B18A]/30'
                  : 'bg-[#29202D] border border-[#34283F] text-[#D4B18A] hover:border-[#D4B18A]/70'
                }
              `}
              style={{
                backgroundColor: isSelected ? intent.color : intent.bgColor,
              }}
            >
              <span className="mr-1">{intent.icon}</span>
              {intent.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Full cards variant
  return (
    <div className="w-full">
      <h2 className="text-lg font-bold text-[#F2E9E4] mb-4 px-1">
        Casual Connections
      </h2>
      <div className="grid grid-cols-3 gap-3">
        {CASUAL_INTENTS.map((intent) => {
          const isSelected = selectedIntent === intent.id;
          const isHovered = hoveredIntent === intent.id;

          return (
            <button
              key={intent.id}
              type="button"
              onClick={() => handleCardClick(intent.id)}
              onMouseEnter={() => setHoveredIntent(intent.id)}
              onMouseLeave={() => setHoveredIntent(null)}
              className="
                group relative aspect-[3/4] rounded-2xl overflow-hidden
                border border-[#34283F] transition-all
                hover:border-[#D4B18A]/70 hover:shadow-lg hover:shadow-[#D4B18A]/20
              "
              style={{
                background: `linear-gradient(135deg, ${intent.bgColor}, #1C1822)`,
              }}
            >
              {/* Gradient overlay */}
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)`,
                }}
              />

              {/* Content */}
              <div className="relative z-10 h-full flex flex-col justify-end p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{intent.icon}</span>
                </div>
                <h3 className="font-bold text-[#F2E9E4] text-left">{intent.label}</h3>
                <p className="text-xs text-[#B58A83] text-left">{intent.description}</p>
              </div>

              {/* Selection indicator */}
              {isSelected && (
                <div
                  className="absolute inset-0 border-2 border-[#D4B18A] rounded-2xl"
                  style={{
                    boxShadow: '0 0 20px rgba(212, 177, 138, 0.3)',
                  }}
                />
              )}

              {/* Hover effect */}
              <div
                className={`
                  absolute inset-0 bg-gradient-to-t from-[#D4B18A]/10 to-transparent
                  transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}
                `}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
