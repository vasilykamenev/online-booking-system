import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const availabilityBlockSchema = z
  .object({
    vesselId: z.guid(),
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().trim().max(300).default(""),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "endDate must be after startDate",
    path: ["endDate"],
  });
export type AvailabilityBlockInput = z.infer<typeof availabilityBlockSchema>;
