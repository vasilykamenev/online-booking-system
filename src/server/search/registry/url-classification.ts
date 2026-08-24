/**
 * Deterministic URL classification (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §4) — path-prefix rules,
 * never AI: a sitemap can hold thousands of URLs, and asking a model to judge each one would be
 * both slow and exactly the kind of routine parsing/classification the rule document says must stay
 * deterministic (§16: "AI must complement deterministic parsing, not replace it").
 *
 * Pure and network-free so it's unit-testable on its own — same split as `robots-rules.ts` vs.
 * `robots.ts`. `url-registry-sync.ts` is the only caller; it supplies either a source's own rows
 * from `search_source_crawl_rules` or falls back to `DEFAULT_CRAWL_RULES` below when a source has
 * none of its own.
 */

export type UrlClassification = "HIGH" | "MEDIUM" | "LOW" | "SKIP";

export interface CrawlRule {
  pattern: string;
  classification: UrlClassification;
  /** Tie-break among rules whose (wildcard-stripped) pattern matches with the same prefix length —
   *  higher wins. */
  priority: number;
  enabled: boolean;
}

/**
 * Applied when a source has no rows of its own in `search_source_crawl_rules` — the same example
 * categories the rule document itself gives (§4): listing pages are worth fetching, destination/
 * category hubs are secondary, blog/legal/account pages are never vessel listings.
 */
export const DEFAULT_CRAWL_RULES: CrawlRule[] = [
  { pattern: "/yachts/", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/yacht/", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/boats/", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/boat/", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/charter/", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/destinations/", classification: "MEDIUM", priority: 0, enabled: true },
  { pattern: "/destination/", classification: "MEDIUM", priority: 0, enabled: true },
  { pattern: "/blog/", classification: "LOW", priority: 0, enabled: true },
  { pattern: "/news/", classification: "LOW", priority: 0, enabled: true },
  { pattern: "/privacy", classification: "SKIP", priority: 0, enabled: true },
  { pattern: "/terms", classification: "SKIP", priority: 0, enabled: true },
  { pattern: "/login", classification: "SKIP", priority: 0, enabled: true },
  { pattern: "/account/", classification: "SKIP", priority: 0, enabled: true },
  { pattern: "/admin/", classification: "SKIP", priority: 0, enabled: true },
];

/** No rule matched — a URL under an unrecognized path is neither promoted nor discarded, it's left
 *  for an admin to notice and classify explicitly (an unknown page silently becoming SKIP would
 *  quietly starve the registry of exactly the pages a new source most needs reviewed). */
const UNMATCHED_RESULT = { classification: "MEDIUM" as UrlClassification, priority: 0 };

/** A rule's trailing `*` (e.g. "/yachts/*") is purely a readability convention matching the rule
 *  document's own example syntax — matching itself is always prefix-based, so it's stripped before
 *  comparison. */
function normalizedPrefix(pattern: string): string {
  return pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
}

/**
 * Longest-prefix-match, same principle as `robots-rules.ts`'s `isAllowedByRobots` — the most
 * specific matching rule wins, not the first or last one in declaration order. Ties (equal prefix
 * length) are broken by `priority` (higher wins), then declaration order.
 */
export function classifyUrl(
  path: string,
  rules: CrawlRule[],
): { classification: UrlClassification; priority: number } {
  let best: CrawlRule | null = null;
  let bestPrefixLength = -1;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const prefix = normalizedPrefix(rule.pattern);
    if (!path.startsWith(prefix)) continue;

    if (
      prefix.length > bestPrefixLength ||
      (prefix.length === bestPrefixLength && best !== null && rule.priority > best.priority)
    ) {
      best = rule;
      bestPrefixLength = prefix.length;
    }
  }

  return best ? { classification: best.classification, priority: best.priority } : UNMATCHED_RESULT;
}
