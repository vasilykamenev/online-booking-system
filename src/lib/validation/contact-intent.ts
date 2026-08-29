import { z } from "zod";

/** Э9 — input for `createContactIntentDraft` (`server/actions/contact-intents.ts`). One zod schema
 *  shared between the server action and the client form, per CLAUDE.md §2. */
export const createContactIntentSchema = z.object({
  // `.guid()` rather than the stricter `.uuid()`: seed data uses placeholder ids (same convention
  // as `booking.ts`/`search.ts` — see their own comments on why).
  sourceId: z.guid(),
  externalId: z.string().trim().min(1).max(2000),
  /** The listing's own page — where REDIRECT_ONLY/EXTERNAL_BOOKING_URL sends the user, and never
   *  looked up server-side: the client already has it on `VesselSearchResult.source.url`, and a
   *  fresh `external_vessel_index` lookup by `(sourceId, externalId)` could legitimately miss (the
   *  indexer already moved on) even though the user is looking at a page that's still open. */
  listingUrl: z.url(),
  vesselName: z.string().trim().max(200).nullable(),
  dateFrom: z.iso.date().nullable(),
  dateTo: z.iso.date().nullable(),
  guests: z.coerce.number().int().positive().max(500).nullable(),
  userNote: z.string().trim().max(1000).nullable(),
});
export type CreateContactIntentInput = z.infer<typeof createContactIntentSchema>;

export const confirmContactIntentSchema = z.object({
  intentId: z.guid(),
  /** The user's final, possibly-edited text — required for a message-based capability, ignored
   *  (never read) for REDIRECT_ONLY/EXTERNAL_BOOKING_URL, which have no message to confirm. */
  messageSent: z.string().trim().max(4000).nullable(),
});
export type ConfirmContactIntentInput = z.infer<typeof confirmContactIntentSchema>;
