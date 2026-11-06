// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ProfileDetailModal from './ProfileDetailModal';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// framer-motion uses WAAPI animations that are unsupported in happy-dom; mock it
// so motion/AnimatePresence render as plain elements for UI assertions.
vi.mock('framer-motion', () => {
  const MotionDiv = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
    (props: React.ComponentProps<'div'>, ref: React.Ref<HTMLDivElement>) => {
      const { children, ...rest } = props;
      return React.createElement('div', { ref, ...rest }, children);
    }
  );
  MotionDiv.displayName = 'motion.div';
  return {
    motion: { div: MotionDiv },
    AnimatePresence: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useMotionValue: () => 0,
    useTransform: () => 0,
    useSpring: (v: unknown) => v,
  };
});

const profile = {
  id: 'user-1',
  displayName: 'Shrisha Giri',
  firstName: 'Shrisha',
  lastName: 'Giri',
  hasLastName: true,
  username: 'shrisha',
  age: 20,
  gender: 'Woman',
  city: 'Copenhagen',
  country: 'Denmark',
  avatarUrl: null,
  photos: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
  bio: 'Love coffee, travel, and good conversation.',
  intention: 'Something long-term',
  lookingFor: ['A partner', 'Adventure'],
  hobbies: [],
  pets: ['Dog'],
  mbti: 'INFJ',
  interests: ['Coffee', 'Travel', 'Reading'],
  casualIntent: null,
  online: true,
  isVerified: true,
  distanceText: '3 km',
  distanceMeters: 3000,
};

describe('ProfileDetailModal', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    document.body.removeChild(container);
  });

  it('renders the profile identity, looking-for, about-me, essentials, lifestyle, basics, interests', () => {
    act(() => {
      root!.render(<ProfileDetailModal profile={profile} isOpen onClose={vi.fn()} />);
    });

    const html = container.innerHTML;
    expect(html).toContain('Shrisha Giri');
    expect(html).toContain('20');
    expect(html).toContain('Looking for');
    expect(html).toContain('A partner');
    expect(html).toContain('About me');
    expect(html).toContain('Love coffee, travel, and good conversation.');
    expect(html).toContain('Essentials');
    expect(html).toContain('Copenhagen, Denmark');
    expect(html).toContain('Gender');
    expect(html).toContain('Woman');
    expect(html).toContain('Lifestyle');
    expect(html).toContain('Dog');
    expect(html).toContain('Basics');
    expect(html).toContain('INFJ');
    expect(html).toContain('Interests');
    expect(html).toContain('Coffee');
    expect(html).toContain('Travel');
    expect(html).toContain('Reading');
    expect(html).toContain('Verified');
    expect(html).toContain('Online');
    expect(html).toContain('3 km away');
  });

  it('hides sections with no available information', () => {
    const minimal = {
      ...profile,
      lookingFor: [],
      bio: null,
      gender: null,
      city: null,
      country: null,
      pets: [],
      mbti: null,
      interests: [],
      isVerified: false,
      online: false,
      distanceText: null,
    };
    act(() => {
      root!.render(<ProfileDetailModal profile={minimal} isOpen onClose={vi.fn()} />);
    });

    const html = container.innerHTML;
    expect(html).not.toContain('Looking for');
    expect(html).not.toContain('About me');
    expect(html).not.toContain('Essentials');
    expect(html).not.toContain('Lifestyle');
    expect(html).not.toContain('Basics');
    expect(html).not.toContain('Interests');
  });

  it('does not render when closed', () => {
    act(() => {
      root!.render(<ProfileDetailModal profile={profile} isOpen={false} onClose={vi.fn()} />);
    });

    expect(container.innerHTML).toBe('');
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    act(() => {
      root!.render(<ProfileDetailModal profile={profile} isOpen onClose={onClose} />);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the photo gallery with all photos', () => {
    act(() => {
      root!.render(<ProfileDetailModal profile={profile} isOpen onClose={vi.fn()} />);
    });

    const html = container.innerHTML;
    expect(html).toContain('https://example.com/photo1.jpg');
    expect(html).toContain('https://example.com/photo2.jpg');
    // Two gallery thumb buttons render for two photos.
    expect(container.querySelectorAll('[aria-label^="View photo"]').length).toBe(2);
  });

  it('handles a profile with no photos gracefully', () => {
    const noPhotos = { ...profile, photos: [] };
    act(() => {
      root!.render(<ProfileDetailModal profile={noPhotos} isOpen onClose={vi.fn()} />);
    });

    expect(container.innerHTML).toContain('👤');
  });
});
