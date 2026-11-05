'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Casual Intent Selection Chips
 *
 * Renders three selectable chips for casual dating intents:
 * - Free Tonight (🌙)
 * - Short Term Fun (🎉)
 * - Friends with Benefits (🔥)
 *
 * Matches the Midnight Romance theme with deep purples and golds.
 * Allows single selection (user can choose one intent at a time).
 */

interface CasualIntentChip {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

const INTENTS: CasualIntentChip[] = [
  {
    id: 'free_tonight',
    label: 'Free Tonight',
    emoji: '🌙',
    description: 'Looking for connections tonight',
  },
  {
    id: 'short_term_fun',
    label: 'Short Term Fun',
    emoji: '🎉',
    description: 'Seeking short-term fun and excitement',
  },
  {
    id: 'friends_with_benefits',
    label: 'Friends with Benefits',
    emoji: '🔥',
    description: 'Looking for casual relationships with benefits',
  },
];

interface CasualIntentChipsProps {
  /** Currently selected casual intent */
  selectedIntent: string | null;
  /** Callback when intent changes */
  onChange?: (intent: string | null) => void;
  /** Whether to show as chips (default) or dropdown */
  variant?: 'chips' | 'select';
  /** Disabled state */
  disabled?: boolean;
  /** Size of chips: 'sm' | 'md' | 'lg' */
  size?: 'sm' | 'md' | 'lg';
}

export default function CasualIntentChips({
  selectedIntent,
  onChange,
  variant = 'chips',
  disabled = false,
  size = 'md',
}: CasualIntentChipsProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback(async (intentId: string | null) => {
    if (disabled) return;

    setError(null);
    setSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Not authenticated');
      }

      // Update the profile in the database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          casual_intent: intentId,
        })
        .eq('id', user.id);

      if (updateError) {
        throw updateError;
      }

      // Call the onChange callback
      onChange?.(intentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update intent');
    } finally {
      setSaving(false);
    }
  }, [disabled, onChange]);

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-3 text-base',
  };

  if (variant === 'select') {
    return (
      <div className="w-full">
        <label className="block text-sm font-medium text-[#B58A83] mb-2">
          Casual Intent
        </label>
        <select
          value={selectedIntent ?? ''}
          onChange={(e) => void handleSelect(e.target.value || null)}
          disabled={disabled || saving}
          className="w-full bg-[#29202D] border border-[#34283F] text-[#F2E9E4] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#D4B18A] disabled:opacity-50"
        >
          <option value="">None</option>
          {INTENTS.map((intent) => (
            <option key={intent.id} value={intent.id}>
              {intent.emoji} {intent.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="mt-2 text-sm text-[#FCA5B5]" role="alert">{error}</p>
        )}
      </div>
    );
  }

  // Chips variant
  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-[#B58A83] mb-3">
        Casual Intent
        {selectedIntent && (
          <span className="ml-2 text-xs text-[#D4B18A]">
            {INTENTS.find((i) => i.id === selectedIntent)?.emoji}
          </span>
        )}
      </label>
      
      <div className="flex gap-2 flex-wrap">
        {INTENTS.map((intent) => {
          const isSelected = selectedIntent === intent.id;
          const isSaving = saving && selectedIntent === intent.id;

          return (
            <button
              key={intent.id}
              type="button"
              onClick={() => void handleSelect(isSelected ? null : intent.id)}
              disabled={disabled || saving}
              className={`
                rounded-full font-semibold transition-all
                ${sizeClasses[size]}
                ${isSelected
                  ? 'bg-[#D4B18A] text-[#17121C] shadow-lg shadow-[#D4B18A]/30'
                  : 'bg-[#29202D] border border-[#34283F] text-[#B58A83] hover:border-[#D4B18A]/70 hover:text-[#D4B18A]'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
              aria-pressed={isSelected}
              aria-label={`Select ${intent.label} intent`}
            >
              <span className="mr-1">{intent.emoji}</span>
              {intent.label}
              {isSaving && (
                <span className="ml-2 animate-spin text-sm">🌀</span>
              )}
            </button>
          );
        })}
        
        {/* Clear button (only show if something is selected) */}
        {selectedIntent && (
          <button
            type="button"
            onClick={() => void handleSelect(null)}
            disabled={disabled || saving}
            className={`
              rounded-full font-semibold transition-all
              ${sizeClasses[size]}
              bg-transparent border border-[#34283F] text-[#B58A83] 
              hover:bg-[#34283F] hover:text-[#F2E9E4]
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            × Clear
          </button>
        )}
      </div>
      
      {error && (
        <p className="mt-2 text-sm text-[#FCA5B5]" role="alert">{error}</p>
      )}
      
      {/* Help text */}
      <p className="mt-3 text-xs text-[#B58A83]/70">
        Select one that best describes what you&apos;re looking for
      </p>
    </div>
  );
}

// Helper to get intent label from ID
export function getCasualIntentLabel(intentId: string | null): string {
  const intent = INTENTS.find((i) => i.id === intentId);
  return intent?.label ?? '';
}

// Helper to get intent emoji from ID
export function getCasualIntentEmoji(intentId: string | null): string {
  const intent = INTENTS.find((i) => i.id === intentId);
  return intent?.emoji ?? '';
}

// Helper to get intent description from ID
export function getCasualIntentDescription(intentId: string | null): string {
  const intent = INTENTS.find((i) => i.id === intentId);
  return intent?.description ?? '';
}
