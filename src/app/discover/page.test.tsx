// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

const viewerId = '11111111-1111-1111-1111-111111111111';

// Inert Supabase client: signed-in user, no RPC data, no errors.
const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: viewerId } } }));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: getUserMock }, rpc: rpcMock },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/discover',
  useSearchParams: () => new URLSearchParams(),
}));

import DiscoverPage from '@/app/discover/page';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Discover page — GO GLOBAL filter', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    document.body.removeChild(container);
  });

  const renderPage = () => {
    act(() => {
      root!.render(<DiscoverPage />);
    });
  };

  const openFilters = () => {
    const btn = container.querySelector('button[aria-label="Open filters"]');
    if (!btn) throw new Error('filter button not found');
    act(() => { (btn as HTMLElement).click(); });
  };

  const toggleGoGlobal = () => {
    const toggle = container.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    act(() => { toggle.click(); });
  };

  const slider = () => container.querySelector('input[type="range"]') as HTMLInputElement;

  it('defaults to local mode: global is false, slider enabled, no global helper', async () => {
    await act(async () => { renderPage(); });
    openFilters();
    const range = slider();
    expect(range.disabled).toBe(false);
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).not.toContain('Searching the entire world');
  });

  it('toggling Go Global on disables the slider and shows the helper text', async () => {
    await act(async () => { renderPage(); });
    openFilters();
    toggleGoGlobal();
    expect(slider().disabled).toBe(true);
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('Searching the entire world');
  });

  it('toggling Go Global off re-enables the slider', async () => {
    await act(async () => { renderPage(); });
    openFilters();
    toggleGoGlobal();
    toggleGoGlobal();
    expect(slider().disabled).toBe(false);
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('preserves the previously selected distance when switching modes', async () => {
    await act(async () => { renderPage(); });
    openFilters();
    const range = slider();
    act(() => {
      range.value = '73';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    toggleGoGlobal(); // slider disabled, value still 73
    expect(slider().value).toBe('73');
    toggleGoGlobal(); // back to local, value restored
    expect(slider().value).toBe('73');
  });

  it('Reset to Default restores local mode and default distance', async () => {
    await act(async () => { renderPage(); });
    openFilters();
    const range = slider();
    act(() => {
      range.value = '99';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    toggleGoGlobal();
    const reset = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Reset')) as HTMLButtonElement;
    act(() => { reset.click(); });
    expect(slider().disabled).toBe(false);
    expect(slider().value).toBe('50');
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });
});
