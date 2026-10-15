import type { Provider } from '@supabase/supabase-js';

/**
 * The OAuth providers Mettivo actually offers.
 *
 * WHY THIS MODULE EXISTS
 *   `auth/page.tsx` and `signup/page.tsx` each declared their own
 *   `type OAuthProvider = 'google' | 'facebook' | 'twitter'`. Two copies of the
 *   same union means adding a provider to one screen and forgetting the other
 *   compiles perfectly and ships a missing button. There is now one list.
 *
 * WHY THE `as const` ARRAY
 *   `OAuthProvider` is derived from the array, so the type and the list cannot
 *   disagree. Adding an id here widens the type automatically.
 */

/** Every provider offered, in the order they appear on screen. */
export const OAUTH_PROVIDER_IDS = ['google', 'facebook', 'twitter', 'discord'] as const;

/** The union of offered provider ids, derived from the list above. */
export type OAuthProvider = (typeof OAUTH_PROVIDER_IDS)[number];

/**
 * Compile-time proof that every id above is a provider Supabase accepts.
 *
 * `Provider` is Supabase's own union (`'google' | 'discord' | 'twitter' | …`).
 * If someone adds a typo such as `'discrod'` to `OAUTH_PROVIDER_IDS`, this
 * assignment stops type-checking and the build fails — instead of shipping a
 * button that only discovers the problem when a member clicks it.
 */
export const OAUTH_PROVIDERS_ARE_SUPPORTED_BY_SUPABASE: readonly Provider[] =
  OAUTH_PROVIDER_IDS;

export interface OAuthProviderBrand {
  /** Button background. */
  background: string;
  /** Button text colour. */
  foreground: string;
  /** Optional border, for dark brands that would otherwise vanish on black. */
  border?: string;
}

/**
 * Brand colours per provider.
 *
 * Discord's brand colour is #5865F2. Twitter/X is intentionally near-black with
 * a border, because a pure-black button on this screen's #121212 background has
 * no edge at all.
 */
export const OAUTH_PROVIDER_BRANDS: Record<OAuthProvider, OAuthProviderBrand> = {
  google: { background: '#1A73E8', foreground: '#ffffff' },
  facebook: { background: '#1877F2', foreground: '#ffffff' },
  twitter: { background: '#000000', foreground: '#ffffff', border: '1px solid #333333' },
  discord: { background: '#5865F2', foreground: '#ffffff' },
};

/** Human label for the button, e.g. "Sign up with Discord". */
export function oauthButtonLabel(provider: OAuthProvider, mode: 'signup' | 'login'): string {
  const name = provider === 'twitter' ? 'Twitter' : provider.charAt(0).toUpperCase() + provider.slice(1);
  return mode === 'signup' ? `Sign up with ${name}` : `Log in with ${name}`;
}
