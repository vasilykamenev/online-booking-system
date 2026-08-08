import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const pricingRuleSchema = z
  .object({
    vesselId: z.guid(),
    label: z.string().trim().min(1).max(120),
    startDate: isoDate,
    endDate: isoDate,
    // Entered in major currency units; converted to minor units before it hits the DB.
    price: z.coerce.number().positive().max(10_000_000),
    priority: z.coerce.number().int().min(0).max(100),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "endDate must be after startDate",
    path: ["endDate"],
  });
export type PricingRuleInput = z.infer<typeof pricingRuleSchema>;
