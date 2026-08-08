import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role client — bypasses RLS. `payments` has no insert/update policy for
 * any authenticated role by design (CLAUDE.md §8: written server-side only, via
 * webhook or manual-transfer confirmation), so writing to it requires this client.
 * Never import from a "use client" file or expose the service-role key to the browser.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
