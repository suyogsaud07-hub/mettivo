'use client';

import { useRef, type KeyboardEvent } from 'react';

/**
 * The dual-tab switch shared by every profile surface.
 *
 *   * "User Feed"    — the member's posts / timeline,
 *   * "User Details" — the structured profile fields.
 *
 * Implements the standard tab keyboard contract (arrows, Home, End) so the
 * visual switch is also a semantic one.
 */

export type ProfileTab = 'feed' | 'details';

export interface ProfileTabsProps {
  active: ProfileTab;
  onChange: (tab: ProfileTab) => void;
}

const TABS: { id: ProfileTab; label: string }[] = [
  { id: 'feed', label: 'User Feed' },
  { id: 'details', label: 'User Details' },
];

export default function ProfileTabs({ active, onChange }: ProfileTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const next = TABS[index];
    if (!next) return;
    onChange(next.id);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      select((index + 1) % TABS.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      select((index - 1 + TABS.length) % TABS.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      select(TABS.length - 1);
    }
  };

  return (
    <div className="pf-tabs" role="tablist" aria-label="Profile sections">
      <div
        className="pf-tab-indicator"
        style={{ transform: active === 'details' ? 'translateX(100%)' : 'translateX(0)' }}
        aria-hidden="true"
      />
      {TABS.map((tab, index) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`profile-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`profile-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className="pf-tab"
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
