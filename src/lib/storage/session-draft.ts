/**
 * Generic, TTL-bounded JSON draft stored in `sessionStorage`, keyed by an arbitrary string.
 *
 * Used to survive a route-segment remount that a plain in-memory React state can't: when a
 * Server Action throws unexpectedly, Next's nearest `error.tsx` unmounts the whole segment, and
 * its "Try again" button (`reset()`) remounts it from scratch — a fresh component instance with
 * no memory of what was on screen. `sessionStorage` (unlike a module-level variable) also
 * survives an actual page reload, so a manual refresh after the same error recovers too.
 *
 * Every read/write is wrapped defensively: private browsing, storage quota, or SSR (no `window`)
 * must degrade to "no draft" rather than throw and break the form around it.
 */

interface StoredDraft<T> {
  savedAt: number;
  data: T;
}

function hasSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

/** Returns the stored draft for `key`, or `null` if there isn't one or it's older than `ttlMs`. */
export function readSessionDraft<T>(key: string, ttlMs: number, now: number = Date.now()): T | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;

    const stored = JSON.parse(raw) as StoredDraft<T>;
    if (now - stored.savedAt > ttlMs) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return stored.data;
  } catch {
    // Corrupt JSON, or storage access blocked — treat exactly like "no draft".
    return null;
  }
}

export function writeSessionDraft<T>(key: string, data: T, now: number = Date.now()): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: now, data } satisfies StoredDraft<T>));
  } catch {
    // Quota exceeded / private browsing — best-effort only, never break the caller.
  }
}

export function clearSessionDraft(key: string): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
