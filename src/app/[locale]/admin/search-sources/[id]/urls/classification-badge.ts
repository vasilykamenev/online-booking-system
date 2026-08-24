import type { Database } from "@/lib/supabase/database.types";

type UrlClassification = Database["public"]["Enums"]["search_url_classification"];

/** Shared between the (server) registry table and the (client) crawl-rule preview panel — both
 *  render the same four classification values and should look identical. */
export const CLASSIFICATION_BADGE_VARIANT: Record<
  UrlClassification,
  "default" | "secondary" | "outline" | "destructive"
> = {
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
  SKIP: "destructive",
};
