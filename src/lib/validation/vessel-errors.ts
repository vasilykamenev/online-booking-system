/**
 * Pure error-classification helpers for the vessel registration/edit Server Actions
 * (`src/server/actions/vessels.ts`). Split out from that "use server" file so this logic
 * — the part that decides what the owner actually sees when something goes wrong — can be
 * unit-tested directly, the same way `src/lib/pricing/` stays pure and test-covered.
 */

export interface VesselActionState {
  error?: string;
  /** Per-field error codes (translated client-side via `errors.${code}`), keyed by form field name. */
  fieldErrors?: Record<string, string>;
  /** Set by `createVessel` on success — the new vessel's id, for the client to attach photos to. */
  vesselId?: string;
}

/** Custom messages already set on the schema (regex/refine) are specific enough to show as-is; anything else collapses to "required" or "fieldInvalid" based on whether the submitted value was empty. */
const KNOWN_FIELD_ERROR_CODES = new Set(["invalidSlug", "invalid"]);

/**
 * Maps a Zod validation failure to one error code per offending field, so the form can show
 * "this field is wrong" instead of one generic banner. Keeps only the first issue per field.
 */
export function buildFieldErrors(
  formData: FormData,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (!field || fieldErrors[field]) continue;
    const raw = formData.get(field);
    const isEmpty = raw == null || raw === "";
    fieldErrors[field] = KNOWN_FIELD_ERROR_CODES.has(issue.message)
      ? issue.message
      : isEmpty
        ? "required"
        : "fieldInvalid";
  }
  return fieldErrors;
}

/** Maps a Postgres error from the vessels insert/update to a field-specific message where possible. */
export function vesselDbError(error: { code?: string }): VesselActionState {
  if (error.code === "23505") return { error: "slugTaken", fieldErrors: { slug: "slugTaken" } };
  if (error.code === "23503") return { error: "generic", fieldErrors: { locationId: "fieldInvalid" } };
  return { error: "generic" };
}

/** True for a `fetch`-level failure (DNS, connection refused, timeout) rather than an app-level bug. */
export function isNetworkActionError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|ECONNREFUSED|ENOTFOUND/i.test(error.message);
}

/**
 * Converts an exception that escaped every explicit `{ error }` check (the Supabase client
 * throwing on a dropped connection, an unexpected runtime error, etc.) into a normal returned
 * state. Letting such an exception propagate instead trips the route's error boundary, which
 * unmounts the whole form and loses everything the owner typed — see `owner/error.tsx`.
 */
export function handleUnexpectedActionError(action: string, error: unknown): VesselActionState {
  console.error(`[vessels:${action}] unexpected error`, error);
  return { error: isNetworkActionError(error) ? "networkError" : "generic" };
}
