/**
 * Deterministic URL classification (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §4) — path-prefix or
 * regex rules, never AI: a sitemap can hold thousands of URLs, and asking a model to judge each one
 * would be both slow and exactly the kind of routine parsing/classification the rule document says
 * must stay deterministic (§16: "AI must complement deterministic parsing, not replace it").
 *
 * Pure and network-free so it's unit-testable on its own — same split as `robots-rules.ts` vs.
 * `robots.ts`. `url-registry-sync.ts` is the only caller; it supplies either a source's own rows
 * from `search_source_crawl_rules` or falls back to `DEFAULT_CRAWL_RULES` below when a source has
 * none of its own.
 */

export type UrlClassification = "HIGH" | "MEDIUM" | "LOW" | "SKIP";
export type CrawlRulePatternType = "PREFIX" | "REGEX";

export interface CrawlRule {
  pattern: string;
  /** "PREFIX" (default) — literal path-prefix match, same convention as `robots-rules.ts`.
   *  "REGEX" — `pattern` is an ECMAScript regular expression source (no delimiters, no flags)
   *  tested against the URL's pathname via `RegExp.test`. */
  patternType: CrawlRulePatternType;
  classification: UrlClassification;
  /** Tie-break among rules that match with the same specificity (see `matchRule`) — higher wins. */
  priority: number;
  enabled: boolean;
}

/**
 * Applied when a source has no rows of its own in `search_source_crawl_rules` — the same example
 * categories the rule document itself gives (§4): listing pages are worth fetching, destination/
 * category hubs are secondary, blog/legal/account pages are never vessel listings.
 */
export const DEFAULT_CRAWL_RULES: CrawlRule[] = [
  { pattern: "/yachts/", patternType: "PREFIX", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/yacht/", patternType: "PREFIX", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/boats/", patternType: "PREFIX", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/boat/", patternType: "PREFIX", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/charter/", patternType: "PREFIX", classification: "HIGH", priority: 0, enabled: true },
  { pattern: "/destinations/", patternType: "PREFIX", classification: "MEDIUM", priority: 0, enabled: true },
  { pattern: "/destination/", patternType: "PREFIX", classification: "MEDIUM", priority: 0, enabled: true },
  { pattern: "/blog/", patternType: "PREFIX", classification: "LOW", priority: 0, enabled: true },
  { pattern: "/news/", patternType: "PREFIX", classification: "LOW", priority: 0, enabled: true },
  { pattern: "/privacy", patternType: "PREFIX", classification: "SKIP", priority: 0, enabled: true },
  { pattern: "/terms", patternType: "PREFIX", classification: "SKIP", priority: 0, enabled: true },
  { pattern: "/login", patternType: "PREFIX", classification: "SKIP", priority: 0, enabled: true },
  { pattern: "/account/", patternType: "PREFIX", classification: "SKIP", priority: 0, enabled: true },
  { pattern: "/admin/", patternType: "PREFIX", classification: "SKIP", priority: 0, enabled: true },
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
 * Regex rules are admin-authored (RLS-gated to `is_admin()`) and compiled once per rule object, not
 * once per URL: `classifyUrl` runs inside a loop over every discovered URL during a sync, so
 * recompiling on every call would be O(urls × rules) instead of O(rules). Keyed by the rule object
 * itself — callers (`url-registry-sync.ts`) load a source's rules once and reuse the same array
 * across every URL in a sync, so the cache is warm for the whole batch.
 */
const regexCache = new WeakMap<CrawlRule, RegExp | null>();

function compiledRegex(rule: CrawlRule): RegExp | null {
  const cached = regexCache.get(rule);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(rule.pattern);
  } catch {
    // Invalid regex syntax never matches rather than throwing — one malformed rule must not abort a
    // whole sync. `crawlRuleSchema` (src/lib/validation/admin.ts) already rejects this at creation
    // time; this is a defense-in-depth fallback, e.g. for rows saved before that check existed.
    compiled = null;
  }
  regexCache.set(rule, compiled);
  return compiled;
}

/**
 * Whether `rule` matches `path`, plus a specificity score used to pick the most specific match among
 * several matching rules. For PREFIX rules this is the (wildcard-stripped) prefix length, unchanged
 * from before. A regex has no natural "prefix length", so REGEX rules use the pattern source's
 * length as the closest analogue — a longer, more constrained pattern is treated as more specific.
 * Ties within a type, or across types, fall back to `priority`.
 */
function matchRule(path: string, rule: CrawlRule): { matches: boolean; specificity: number } {
  if (rule.patternType === "REGEX") {
    const regex = compiledRegex(rule);
    return regex ? { matches: regex.test(path), specificity: rule.pattern.length } : { matches: false, specificity: 0 };
  }
  const prefix = normalizedPrefix(rule.pattern);
  return { matches: path.startsWith(prefix), specificity: prefix.length };
}

/**
 * Most-specific-match-wins, same principle as `robots-rules.ts`'s `isAllowedByRobots` — the most
 * specific matching rule wins, not the first or last one in declaration order. Ties (equal
 * specificity) are broken by `priority` (higher wins), then declaration order.
 */
export function classifyUrl(
  path: string,
  rules: CrawlRule[],
): { classification: UrlClassification; priority: number } {
  let best: CrawlRule | null = null;
  let bestSpecificity = -1;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const { matches, specificity } = matchRule(path, rule);
    if (!matches) continue;

    if (
      specificity > bestSpecificity ||
      (specificity === bestSpecificity && best !== null && rule.priority > best.priority)
    ) {
      best = rule;
      bestSpecificity = specificity;
    }
  }

  return best ? { classification: best.classification, priority: best.priority } : UNMATCHED_RESULT;
}
