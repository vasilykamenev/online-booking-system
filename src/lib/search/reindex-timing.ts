/** Vercel Hobby's hard `maxDuration` cap (`urls/page.tsx`'s own `export const maxDuration = 300`)
 *  plus a buffer for cold start/queueing — past this with no `finished_at`, a run is presumed dead
 *  rather than genuinely still in flight. No `server-only` import: shared between the server-side
 *  reindexer (`index/reindex-progress.ts`) and the client-side status hook. */
export const REINDEX_ASSUMED_TIMEOUT_MS = 330_000;
