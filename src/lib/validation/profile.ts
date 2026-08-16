import { z } from "zod";
import { routing } from "@/i18n/routing";
import { currencyCodes } from "@/lib/currencies";

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  locale: z.enum(routing.locales),
  currency: z.enum(currencyCodes),
});
export type ProfileInput = z.infer<typeof profileSchema>;
