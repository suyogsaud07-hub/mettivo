import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §3.2 — the OAuth callback route handler, with Supabase mocked.
 *
 * `/auth/callback` is the one server route in the product, and it is the only
 * place a session is created. Every branch below is a real outcome an attacker
 * or a flaky provider can produce, and the rule for all of them is the same:
 * **an unauthenticated visitor must never be admitted, and a failure must always
 * land somewhere that cannot loop.**
 *
 * `vi.hoisted` is required because `vi.mock` factories are lifted above the
 * module body; without it the factory would close over uninitialised bindings.
 */

const mocks = vi.hoisted(() => {
  const profileResult: { data: unknown; error: unknown } = { data: null, error: null };
  const maybeSingle = vi.fn(async () => profileResult);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    profileResult,
    exchangeCodeForSession: vi.fn(),
    getUser: vi.fn(),
    from,
    createServerClient: vi.fn(() => ({
      auth: {
        exchangeCodeForSession: (code: string) => mocks_exchange(code),
        getUser: () => mocks_getUser(),
      },
      from,
    })),
  };
});

// The factory above cannot reference itself, so the two shared fns are wired
// through module-scope holders that `vi.hoisted` has already initialised.
function mocks_exchange(code: string) {
  return mocks.exchangeCodeForSession(code);
}
function mocks_getUser() {
  return mocks.getUser();
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

const { GET } = await import('@/app/auth/callback/route');

const CALLBACK = 'https://mettivo.test/auth/callback';

async function call(query: string): Promise<string | null> {
  const response = await GET(new Request(`${CALLBACK}${query}`));
  return response.headers.get('location');
}

describe('§3.2 — /auth/callback route handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileResult.data = null;
    mocks.profileResult.error = null;
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  it('redirects to /auth when no code is present', async () => {
    expect(await call('')).toBe('https://mettivo.test/auth');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('exchanges the code exactly once on the happy path', async () => {
    mocks.profileResult.data = { onboarding_completed: true };

    expect(await call('?code=abc123')).toBe('https://mettivo.test/discover');
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('refuses a failed exchange and never creates a session', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: 'invalid grant' },
    });

    expect(await call('?code=stolen')).toBe('https://mettivo.test/auth');
    // A failed exchange must not proceed to read a user or a profile.
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('refuses when the session has no user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await call('?code=abc')).toBe('https://mettivo.test/auth');
  });

  it('refuses when getUser reports an error', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'jwt expired' },
    });
    expect(await call('?code=abc')).toBe('https://mettivo.test/auth');
  });

  it('sends a member with no profile to onboarding', async () => {
    // A brand-new account has no profiles row at all; `maybeSingle` returns null
    // rather than an error, which must route to onboarding and not to /discover.
    mocks.profileResult.data = null;
    expect(await call('?code=abc')).toBe('https://mettivo.test/profile');
  });

  it('sends a member who has not finished onboarding back to the wizard', async () => {
    mocks.profileResult.data = { onboarding_completed: false };
    expect(await call('?code=abc')).toBe('https://mettivo.test/profile');
  });

  it('admits a fully onboarded member', async () => {
    mocks.profileResult.data = { onboarding_completed: true };
    expect(await call('?code=abc')).toBe('https://mettivo.test/discover');
  });

  it('fails closed when Supabase throws instead of returning an error', async () => {
    // An unexpected throw must not 500 the route or leak a stack trace: the
    // visitor is simply sent back to sign in.
    mocks.exchangeCodeForSession.mockRejectedValue(new Error('socket hang up'));
    expect(await call('?code=abc')).toBe('https://mettivo.test/auth');
  });

  it('fails closed when the cookie store throws', async () => {
    const { cookies } = await import('next/headers');
    vi.mocked(cookies).mockRejectedValueOnce(new Error('no request scope'));
    expect(await call('?code=abc')).toBe('https://mettivo.test/auth');
  });

  it('never redirects off-origin', async () => {
    // The redirect target is built from the request origin, never from an
    // attacker-supplied parameter, so `?next=` cannot turn this into an
    // open redirect.
    mocks.profileResult.data = { onboarding_completed: true };
    const location = await call('?code=abc&next=https://evil.example');
    expect(location?.startsWith('https://mettivo.test/')).toBe(true);
    expect(location).not.toContain('evil.example');
  });
});
