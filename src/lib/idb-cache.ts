import { openDB, type IDBPDatabase } from 'idb';

/**
 * Mettivo offline cache — IndexedDB via `idb`.
 *
 * Caches the signed-in member's profile and dashboard data so the app can
 * render a usable screen when the network is unavailable. Supabase auth
 * continues to persist its own session in cookies (unchanged); this layer is
 * purely for application data.
 *
 * Store: `cache`
 *   Key:   `profile:<userId>`  -> Profile JSON (from `public.profiles`)
 *   Key:   `moments:<userId>`  -> Moments JSON (from `moment_feed`)
 *   Key:   `meta:<userId>`     -> { cachedAt: ISO string }
 */

const DB_NAME = 'mettivo-offline';
const DB_VERSION = 1;
const STORE = 'cache';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

/** Cache the member's profile (and a timestamp). Returns the key used. */
export async function cacheProfile(userId: string, profile: unknown): Promise<void> {
  const db = await getDB();
  const payload = { profile, cachedAt: new Date().toISOString() };
  await db.put(STORE, payload, `profile:${userId}`);
  await db.put(STORE, { cachedAt: new Date().toISOString() }, `meta:${userId}`);
}

/** Read the cached profile for a user, or null if nothing is cached. */
export async function getCachedProfile(userId: string): Promise<{ profile: unknown; cachedAt: string } | null> {
  const db = await getDB();
  const row = await db.get(STORE, `profile:${userId}`);
  if (!row) return null;
  return row as { profile: unknown; cachedAt: string };
}

/** Cache the member's moments. */
export async function cacheMoments(userId: string, moments: unknown[]): Promise<void> {
  const db = await getDB();
  await db.put(STORE, { moments, cachedAt: new Date().toISOString() }, `moments:${userId}`);
}

/** Read the cached moments for a user, or null. */
export async function getCachedMoments(userId: string): Promise<{ moments: unknown[]; cachedAt: string } | null> {
  const db = await getDB();
  const row = await db.get(STORE, `moments:${userId}`);
  if (!row) return null;
  return row as { moments: unknown[]; cachedAt: string };
}

/** Clear all cached data for a user (e.g. on sign-out). */
export async function clearCacheForUser(userId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, `profile:${userId}`);
  await db.delete(STORE, `moments:${userId}`);
  await db.delete(STORE, `meta:${userId}`);
}

/** True when the browser reports no network connection. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}
