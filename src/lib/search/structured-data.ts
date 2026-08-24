/**
 * Pure JSON-LD sniffing: detects whether a page publishes schema.org structured data at all, and
 * which `@type`s it declares — without claiming to know whether those types describe vessel
 * offers. That semantic judgment is a separate, AI-driven classification step for a later
 * iteration; this only feeds the STRUCTURED_DATA vs. HTML processing-type suggestion shown during
 * source registration (`src/server/search/source-validation.ts`).
 */

function collectTypes(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") into.add(type);
  else if (Array.isArray(type)) {
    for (const entry of type) if (typeof entry === "string") into.add(entry);
  }

  // `@graph` is JSON-LD's way of packing multiple entities into one script block.
  if ("@graph" in record) collectTypes(record["@graph"], into);
}

const SCRIPT_PATTERN = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Extracts every `@type` declared across a page's `<script type="application/ld+json">` blocks.
 * A malformed block is skipped, not fatal — one broken script tag must not hide data in the others.
 */
export function extractJsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    try {
      collectTypes(JSON.parse(match[1]), types);
    } catch {
      continue;
    }
  }
  return [...types];
}

export interface JsonLdFields {
  name: string | null;
  description: string | null;
  image: string | null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
      // schema.org `image` is sometimes an ImageObject rather than a bare URL string.
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") {
        return (item as Record<string, unknown>).url as string;
      }
    }
    return null;
  }
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).url === "string") {
    return (value as Record<string, unknown>).url as string;
  }
  return null;
}

/**
 * Site-wide/organizational schema types, never the listing a page is actually about. Almost every
 * commercial site injects one of these on every page (nav header, footer, or site-level SEO
 * boilerplate) — usually *before* any page-specific JSON-LD in document order — so without this
 * exclusion `findFirstNamedNode` locks onto the site's own name/logo on every page of a source
 * (observed live on globesailor.ru: a page-wide `TravelAgency` block named "GlobeSailor" precedes
 * the page's actual `Product` block in every listing page's HTML). Not a positive `@type` allowlist
 * (see this file's other doc comment for why) — just the types that are structurally never the
 * page's showcased item, regardless of what that item's own type turns out to be.
 */
const NON_LISTING_TYPES = new Set([
  "Organization",
  "TravelAgency",
  "LocalBusiness",
  "Corporation",
  "WebSite",
  "WebPage",
  "BreadcrumbList",
  "SiteNavigationElement",
]);

function isNonListingNode(record: Record<string, unknown>): boolean {
  const type = record["@type"];
  const types = typeof type === "string" ? [type] : Array.isArray(type) ? type : [];
  return types.some((entry) => typeof entry === "string" && NON_LISTING_TYPES.has(entry));
}

function findFirstNamedNode(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstNamedNode(item);
      if (found) return found;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  if (!isNonListingNode(record) && typeof record.name === "string" && record.name.trim()) {
    return record;
  }
  if ("@graph" in record) return findFirstNamedNode(record["@graph"]);
  return null;
}

/**
 * Pulls basic listing fields (name/description/image) off the first JSON-LD node that declares a
 * `name` and isn't a known site-wide/organizational type (`NON_LISTING_TYPES`) — deliberately not
 * filtered to a positive `@type` allowlist (schema.org has no dedicated "boat" type, and site owners
 * rarely tag charter listings precisely as `Product`), so this trusts "has a name, and isn't clearly
 * about the site itself" as the signal that a node describes the thing the page is about. Returns
 * `null` when no page-wide JSON-LD carries such a name at all, which is a fact about the page, not a
 * failure.
 */
export function extractJsonLdFields(html: string): JsonLdFields | null {
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const node = findFirstNamedNode(parsed);
    if (!node) continue;
    return {
      name: firstString(node.name),
      description: firstString(node.description),
      image: firstString(node.image),
    };
  }
  return null;
}
