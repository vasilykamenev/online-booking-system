import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createBookingSchema = z
  .object({
    // `.guid()` rather than the stricter `.uuid()`: seed data uses placeholder ids
    // like "40000000-0000-0000-0000-000000000001" without a valid RFC 4122 version/variant nibble.
    vesselId: z.guid(),
    checkIn: isoDate,
    checkOut: isoDate,
    guestsCount: z.coerce.number().int().min(1).max(64),
  })
  .refine((data) => data.checkOut > data.checkIn, {
    message: "checkOut must be after checkIn",
    path: ["checkOut"],
  });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
