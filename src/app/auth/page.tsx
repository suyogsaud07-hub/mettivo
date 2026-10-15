'use client';

import AuthPanel from '@/app/components/AuthPanel';

/**
 * `/auth` — sign in.
 *
 * This page is intentionally a thin wrapper. The surface itself lives in
 * `AuthPanel`, which `/signup` renders too: the two routes were near-identical
 * copies that had already drifted (this one had the inline email form, `/signup`
 * still used `prompt()`/`alert()`), so all of the logic and all of the styling
 * now have exactly one home.
 *
 * Keeping the route means existing links, the OAuth redirect target and the
 * middleware's unauthenticated landing spot all still resolve.
 */
export default function AuthPage() {
  return <AuthPanel />;
}
