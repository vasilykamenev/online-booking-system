import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { CandidateClassification } from "@/server/search/candidate-classifier";

/**
 * Persistent counterpart to `providers/generic/provider.ts`'s in-memory `classificationCache`
 * (Э5) — `src/server/search/README.md` has carried a "не реализован" note on this exact gap since
 * P3 shipped. Keyed by content hash, not by (source, url): identical HTML — the same page re-fetched
 * after a cache miss, or byte-identical boilerplate shared across two listings — never re-pays for a
 * second AI call, independent of which URL or source it came from. Read-through is best-effort on
 * both sides: a cache miss or write failure degrades to "call the model", never fails the extraction.
 */

export async function getCachedClassification(contentHash: string): Promise<CandidateClassification | null> {
  const { data } = await createAdminClient()
    .from("search_extraction_cache")
    .select("classification")
    .eq("content_hash", contentHash)
    .maybeSingle();
  return (data?.classification as CandidateClassification | undefined) ?? null;
}

export async function cacheClassification(
  contentHash: string,
  classification: CandidateClassification,
): Promise<void> {
  await createAdminClient()
    .from("search_extraction_cache")
    .upsert({ content_hash: contentHash, classification: classification as unknown as Json }, { onConflict: "content_hash" });
}
