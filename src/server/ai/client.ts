import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * The project's single AI entry point (spec §12: processing stays inside our own architecture, and
 * the only outside party involved is the model integrated into it).
 *
 * Returning `null` rather than throwing when the key is missing is deliberate: global search must
 * degrade to its deterministic path on a machine with no key — a fresh checkout, CI, a preview
 * deploy — instead of failing the whole feature.
 */

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  cached ??= new Anthropic({ apiKey });
  return cached;
}

export const AI_MODELS = {
  /**
   * Query understanding — one call per search, and the call whose quality shapes everything
   * downstream, so it gets the stronger model.
   */
  interpretation: "claude-sonnet-5",
  /**
   * Page extraction — potentially dozens of calls per search over large HTML bodies, so it gets
   * the cheap fast model. Accuracy is backstopped by deterministic extraction running first
   * (spec §11) and by confidence scores on whatever the model does produce (spec §15).
   */
  extraction: "claude-haiku-4-5-20251001",
  /**
   * Contact/booking intent message drafting (Э9, Арх §18 п.7) — one call per intent a user
   * actually creates, never per page or per search, so it gets the stronger model the same way
   * interpretation does: low volume, and the one thing the user reads and edits before it's ever
   * sent anywhere.
   */
  messageDraft: "claude-sonnet-5",
} as const;

/**
 * Wall-clock ceiling for a single model call. Global search has a latency budget to respect
 * (BRD §8), and a hung call must surface as degraded-but-useful rather than as a spinner.
 */
export const AI_CALL_TIMEOUT_MS = 8_000;
