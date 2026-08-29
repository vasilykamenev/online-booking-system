import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { VesselSearchResult } from "@/lib/search/offer";
import { assessDuplicate, type DuplicateAssessment, type DuplicateComparable } from "@/lib/search/dedupe";
import { normalizeForMatch } from "@/lib/search/text";
import { arbitrateDuplicate } from "@/server/ai/duplicate-arbitration";

/**
 * Э11 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §17): persistent vessel identity for
 * external offers — see the Э11 migration's own doc comment for why this is a plain FK on
 * `external_vessel_index` rather than the plan's literal "vessel_identities +
 * vessel_identity_offers" bridge table, and for why internal vessels are out of scope entirely.
 *
 * Called once per freshly-extracted listing, from `index/indexer.ts` and `index/brilions-indexer.ts`
 * right after `recordExtraction` — never from the live search path, matching Арх §18's "AI на
 * онбординге и при поломке, не на каждом запросе" cadence this codebase already applies to Э10's
 * structure-health check. Best-effort throughout: a failure here must never fail the indexing run
 * that's attempting it (`resolveVesselIdentity` never throws), since identity linkage is an
 * enhancement over what `dedupe.ts`'s per-request pass already does correctly on its own, not a
 * requirement for a listing to be indexed and searchable.
 *
 * Matching quality is bounded by what the extraction pipeline actually populates today:
 * `manufacturer`/`model`/`year`/`lengthMeters` exist as columns and flow all the way through to
 * `VesselSearchResult` (`vessel-index.ts`'s `CANDIDATE_COLUMNS`), but nothing in
 * `providers/generic/provider.ts`'s selector/JSON-LD/AI tiers extracts them yet — this is a real,
 * pre-existing gap in extraction *quality*, out of Э11's own scope (identity *persistence*).
 * `assessDuplicate` already treats a null field as "no opinion" rather than a mismatch, so matching
 * today leans mostly on name similarity, shared images, and city/marina — and improves automatically,
 * with no code change here, the moment extraction starts filling those columns.
 */

type VesselIdentityRow = Database["public"]["Tables"]["vessel_identities"]["Row"];

/** A pair whose deterministic score clears this floor but not `MERGE_THRESHOLD` gets exactly one
 *  AI arbitration call — matches `dedupe.ts`'s own `NAME_GATE` (below which a pair isn't worth
 *  scoring at all), reused here as this module's floor for "worth asking a human-equivalent
 *  question about" rather than "not even a plausible match". */
export const GREY_ZONE_MIN = 0.55;

/** Bounds the `ilike` blocking-key lookup — see the Э11 migration's own note on why this is a plain
 *  index rather than a trigram search: cheap today, revisit if identity volume ever makes this the
 *  indexer's bottleneck. */
const CANDIDATE_LOOKUP_LIMIT = 20;

/** Skips blocking on a token too short/common to narrow anything down ("a", "de", "la") — a lookup
 *  that would return "every identity" is worse than skipping it, since it costs a full table scan
 *  for `findCandidateIdentities`'s own bounded `.limit()` to then discard. */
const MIN_BLOCKING_TOKEN_LENGTH = 3;

function identityToComparable(identity: VesselIdentityRow): DuplicateComparable {
  return {
    name: identity.canonical_name,
    year: identity.year,
    lengthMeters: identity.length_meters,
    manufacturer: identity.manufacturer,
    model: identity.model,
    location: { city: identity.city, marina: identity.marina },
    images: identity.representative_image ? [{ url: identity.representative_image }] : [],
  };
}

/** The longest normalized token in a name — the single most distinguishing word to block on
 *  ("bavaria" out of "Bavaria Cruiser 36", not "cruiser" or "36"). Exported for its own unit test;
 *  otherwise this module's only pure function. */
export function longestNameToken(name: string | null): string | null {
  if (!name) return null;
  const tokens = normalizeForMatch(name)
    .split(/\s+/)
    .filter((token) => token.length >= MIN_BLOCKING_TOKEN_LENGTH);
  if (tokens.length === 0) return null;
  return tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
}

async function findCandidateIdentities(candidateName: string | null): Promise<VesselIdentityRow[]> {
  const token = longestNameToken(candidateName);
  if (!token) return [];

  const { data } = await createAdminClient()
    .from("vessel_identities")
    .select("id, canonical_name, vessel_type, manufacturer, model, year, length_meters, city, marina, representative_image, offer_count, created_at, updated_at")
    .ilike("canonical_name", `%${token}%`)
    .limit(CANDIDATE_LOOKUP_LIMIT);

  return data ?? [];
}

/** Best-matching candidate among `identities`, or `null` if every one was vetoed (a hard
 *  contradiction — different build year, wildly different length — rules a candidate out
 *  regardless of how similar the name looks). */
function pickBestCandidate(
  candidate: VesselSearchResult,
  identities: VesselIdentityRow[],
): { identity: VesselIdentityRow; assessment: DuplicateAssessment } | null {
  let best: { identity: VesselIdentityRow; assessment: DuplicateAssessment } | null = null;
  for (const identity of identities) {
    const assessment = assessDuplicate(candidate, identityToComparable(identity));
    if (assessment.vetoedBy) continue;
    if (!best || assessment.score > best.assessment.score) best = { identity, assessment };
  }
  return best;
}

/** Fills only the identity's gaps from `candidate` — the identity's own already-set values always
 *  win, same "own values win, only fill gaps" discipline `dedupe.ts`'s `mergeResults` applies to a
 *  per-request merge. Keeps the canonical snapshot stable across many offers attaching over time
 *  instead of flip-flopping to whichever offer happened to index most recently. */
async function attachToIdentity(
  identity: VesselIdentityRow,
  candidate: VesselSearchResult,
  method: Extract<Database["public"]["Enums"]["vessel_identity_match_method"], "DETERMINISTIC" | "AI">,
  score: number,
  indexId: string,
): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from("vessel_identities")
    .update({
      canonical_name: identity.canonical_name ?? candidate.name,
      vessel_type: identity.vessel_type ?? candidate.vesselType,
      manufacturer: identity.manufacturer ?? candidate.manufacturer,
      model: identity.model ?? candidate.model,
      year: identity.year ?? candidate.year,
      length_meters: identity.length_meters ?? candidate.lengthMeters,
      city: identity.city ?? candidate.location.city,
      marina: identity.marina ?? candidate.location.marina,
      representative_image: identity.representative_image ?? candidate.images[0]?.url ?? null,
      offer_count: identity.offer_count + 1,
    })
    .eq("id", identity.id);

  await supabase
    .from("external_vessel_index")
    .update({ vessel_identity_id: identity.id, identity_match_method: method, identity_match_score: score })
    .eq("id", indexId);
}

async function seedNewIdentity(candidate: VesselSearchResult, indexId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: created } = await supabase
    .from("vessel_identities")
    .insert({
      canonical_name: candidate.name,
      vessel_type: candidate.vesselType,
      manufacturer: candidate.manufacturer,
      model: candidate.model,
      year: candidate.year,
      length_meters: candidate.lengthMeters,
      city: candidate.location.city,
      marina: candidate.location.marina,
      representative_image: candidate.images[0]?.url ?? null,
    })
    .select("id")
    .single();
  if (!created) return;

  await supabase
    .from("external_vessel_index")
    .update({ vessel_identity_id: created.id, identity_match_method: "SEED", identity_match_score: null })
    .eq("id", indexId);
}

/**
 * Resolves and persists `indexId`'s (an `external_vessel_index` row's) vessel identity: attach to
 * an existing one (deterministically confident, or AI-arbitrated for a grey-zone score), or seed a
 * new one when nothing plausible exists yet. `candidate` is the same normalized result the caller
 * just extracted — reused here rather than re-read from the database.
 */
export async function resolveVesselIdentity(indexId: string, candidate: VesselSearchResult): Promise<void> {
  try {
    const identities = await findCandidateIdentities(candidate.name);
    const best = pickBestCandidate(candidate, identities);

    if (best && best.assessment.confident) {
      await attachToIdentity(best.identity, candidate, "DETERMINISTIC", best.assessment.score, indexId);
      return;
    }

    if (best && best.assessment.score >= GREY_ZONE_MIN) {
      const sameVessel = await arbitrateDuplicate(
        candidate,
        identityToComparable(best.identity),
        best.assessment,
      );
      if (sameVessel) {
        await attachToIdentity(best.identity, candidate, "AI", best.assessment.score, indexId);
        return;
      }
    }

    await seedNewIdentity(candidate, indexId);
  } catch {
    // Best-effort — see this module's own doc comment on why identity linkage never fails indexing.
  }
}
