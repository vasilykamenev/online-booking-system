import { z } from "zod";
import { routing } from "@/i18n/routing";

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  locale: z.enum(routing.locales),
  currency: z.string().length(3),
});
export type ProfileInput = z.infer<typeof profileSchema>;
