import "server-only";
import { AI_CALL_TIMEOUT_MS, AI_MODELS, getAnthropicClient } from "@/server/ai/client";
import type { DuplicateAssessment, DuplicateComparable } from "@/lib/search/dedupe";

/**
 * Э11 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §17, §18 п.6): the tie-breaker for a
 * "grey zone" pair `server/search/identity/vessel-identity.ts` found — deterministic signals scored
 * it above the noise floor but below `dedupe.ts`'s `MERGE_THRESHOLD`, so `assessDuplicate` alone
 * can't confidently decide either way. One call per such pair, never per search request.
 *
 * `dedupe.ts`'s own founding rule governs the failure mode here too: "wrongly merging two
 * similar-but-distinct yachts... is worse than showing a near-duplicate." No API key, a network
 * failure, a timeout, or an unparseable answer all resolve to `false` — never merge on uncertain
 * grounds — same "degrade to the safe deterministic default" contract every other AI-optional module
 * in this codebase follows.
 */

const ARBITRATION_TOOL = {
  name: "record_duplicate_decision",
  description:
    "Record whether two vessel-charter listings, found on different sites, describe the SAME " +
    "physical vessel.",
  input_schema: {
    type: "object" as const,
    properties: {
      sameVessel: { type: "boolean" },
    },
    required: ["sameVessel"],
  },
};

function describe(entry: DuplicateComparable): string {
  const parts = [
    entry.name ?? "(no name)",
    entry.manufacturer,
    entry.model,
    entry.year !== null ? `built ${entry.year}` : null,
    entry.lengthMeters !== null ? `${entry.lengthMeters}m` : null,
    entry.location.marina ?? entry.location.city,
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * `a`/`b` are the two records the caller's own `assessDuplicate(a, b)` already scored into
 * `assessment` — passed through rather than recomputed, so the model sees exactly the same signal
 * breakdown a human reviewer would.
 */
export async function arbitrateDuplicate(
  a: DuplicateComparable,
  b: DuplicateComparable,
  assessment: DuplicateAssessment,
): Promise<boolean> {
  const client = getAnthropicClient();
  if (!client) return false;

  try {
    const response = await client.messages.create(
      {
        model: AI_MODELS.duplicateArbitration,
        max_tokens: 256,
        system: [
          "You decide whether two vessel-charter listings, found on different sites, describe the",
          "SAME physical vessel versus two distinct (if similar) vessels. Deterministic signals",
          "already compared them and could not decide confidently — you are the tie-breaker for a",
          "genuinely ambiguous case, not a first pass. When in doubt, answer false: wrongly merging",
          "two different vessels attributes one vessel's price and availability to another, which is",
          "worse than leaving them shown as separate listings. Always answer by calling",
          "record_duplicate_decision.",
        ].join("\n"),
        tools: [ARBITRATION_TOOL],
        tool_choice: { type: "tool", name: ARBITRATION_TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              `Listing A: ${describe(a)}`,
              `Listing B: ${describe(b)}`,
              `Deterministic per-signal scores (0-1, higher = more alike): ${JSON.stringify(assessment.signals)}`,
              `Combined deterministic score: ${assessment.score.toFixed(2)} (below the auto-merge threshold, or this call wouldn't be happening)`,
            ].join("\n"),
          },
        ],
      },
      { timeout: AI_CALL_TIMEOUT_MS },
    );

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return false;

    const input = toolUse.input as { sameVessel?: unknown };
    return input.sameVessel === true;
  } catch {
    return false;
  }
}
