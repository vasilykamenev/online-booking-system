import "server-only";

/**
 * Supabase query/auth errors ({message, details, hint, code}) are plain
 * objects, not `Error` instances. Throwing them raw loses the stack trace and
 * renders as an unreadable object dump in Next's error overlay and in logs.
 */
export function throwIfSupabaseError(error: { message: string } | null): void {
  if (error) throw new Error(error.message, { cause: error });
}
