/**
 * M21 — shared bearer-token check for the moderation worker endpoints.
 *
 * Pure and environment-free: the route resolves the expected secret (a server
 * value) and asks this module whether the request carries it. Kept separate so
 * both worker routes share one comparison and one place to get the constant-time
 * detail right.
 */

/** Constant-time string equality, safe for a shared secret comparison. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** True when the request presents `secret` as `Authorization: Bearer <secret>`. */
export function isAuthorisedBearer(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return constantTimeEqual(match[1], secret);
}
