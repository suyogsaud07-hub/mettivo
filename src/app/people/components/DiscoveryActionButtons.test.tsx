// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DiscoveryActionButtons from './DiscoveryActionButtons';

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
  const MotionButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
    (props: React.ComponentProps<'button'>, ref: React.Ref<HTMLButtonElement>) => {
      const { children, ...rest } = props;
      return React.createElement('button', { ref, ...rest }, children);
    }
  );
  MotionButton.displayName = 'motion.button';
  return {
    motion: { div: MotionDiv, button: MotionButton },
    AnimatePresence: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

const current = { id: 'user-1', displayName: 'Shrisha Giri' };

describe('DiscoveryActionButtons', () => {
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

  it('renders all five action buttons with accessible labels', () => {
    const onRewind = vi.fn();
    const onPass = vi.fn();
    const onSuperLike = vi.fn();
    const onLike = vi.fn();
    const onMessage = vi.fn();

    act(() => {
      root!.render(
        <DiscoveryActionButtons
          current={current}
          decisionPending={null}
          canRewind={true}
          isRewinding={false}
          onRewind={onRewind}
          onPass={onPass}
          onSuperLike={onSuperLike}
          onLike={onLike}
          onMessage={onMessage}
        />
      );
    });

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(5);

    const labels = Array.from(buttons).map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels).toContain('Rewind on Shrisha Giri');
    expect(labels).toContain('Pass on Shrisha Giri');
    expect(labels).toContain('Super Like on Shrisha Giri');
    expect(labels).toContain('Like on Shrisha Giri');
    expect(labels).toContain('Message on Shrisha Giri');
  });

  it('invokes onLike and onPass when clicked', () => {
    const onLike = vi.fn();
    const onPass = vi.fn();
    act(() => {
      root!.render(
        <DiscoveryActionButtons
          current={current}
          decisionPending={null}
          canRewind={true}
          isRewinding={false}
          onRewind={vi.fn()}
          onPass={onPass}
          onSuperLike={vi.fn()}
          onLike={onLike}
          onMessage={vi.fn()}
        />
      );
    });

    const buttons = container.querySelectorAll('button');
    // Pass is button index 1 (rewind, pass, like, superlike, message)
    act(() => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(onPass).toHaveBeenCalledWith('user-1');

    act(() => {
      (buttons[2] as HTMLButtonElement).click();
    });
    expect(onLike).toHaveBeenCalledWith('user-1');
  });

  it('disables the rewind button when not available', () => {
    act(() => {
      root!.render(
        <DiscoveryActionButtons
          current={current}
          decisionPending={null}
          canRewind={false}
          isRewinding={false}
          onRewind={vi.fn()}
          onPass={vi.fn()}
          onSuperLike={vi.fn()}
          onLike={vi.fn()}
          onMessage={vi.fn()}
        />
      );
    });

    const buttons = container.querySelectorAll('button');
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect(buttons[0].getAttribute('aria-label')).toBe('Rewind unavailable');
  });

  it('disables all buttons while a decision is pending', () => {
    act(() => {
      root!.render(
        <DiscoveryActionButtons
          current={current}
          decisionPending={current.id}
          canRewind={true}
          isRewinding={false}
          onRewind={vi.fn()}
          onPass={vi.fn()}
          onSuperLike={vi.fn()}
          onLike={vi.fn()}
          onMessage={vi.fn()}
        />
      );
    });

    const buttons = container.querySelectorAll('button');
    buttons.forEach((b) => {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('renders nothing when there is no current profile', () => {
    act(() => {
      root!.render(
        <DiscoveryActionButtons
          current={null}
          decisionPending={null}
          canRewind={true}
          isRewinding={false}
          onRewind={vi.fn()}
          onPass={vi.fn()}
          onSuperLike={vi.fn()}
          onLike={vi.fn()}
          onMessage={vi.fn()}
        />
      );
    });

    expect(container.innerHTML).toBe('');
  });
});
