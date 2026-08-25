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
  /** Major units (e.g. `9500` for "9500 EUR") — the cheapest currently-available offer attached to
   *  the listing node, not just whichever `offers` entry happens to come first. `null` when there's
   *  no `offers`, no parseable price, every offer is declared out of stock, or `priceConflict` is
   *  true (never guess which of two disagreeing prices is right). */
  price: number | null;
  currency: string | null;
  /** True when this page's own JSON-LD disagrees with itself about price across more than one named
   *  listing node — a real failure mode sites produce (duplicated/stale `Product` blocks). `price`
   *  and `currency` are `null` whenever this is true. */
  priceConflict: boolean;
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
 * Indexes every node in a parsed JSON-LD document by its `@id`, so a bare reference like
 * `{"@id": "https://example.com/#offer-1"}` can be resolved to the node it actually points at.
 * `@graph` documents commonly declare an `Offer`/`Organization` node once and reference it from
 * several places rather than repeating it inline — see rules doc §20.5.
 */
function collectNodesById(node: unknown, into: Map<string, Record<string, unknown>>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectNodesById(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  const id = record["@id"];
  if (typeof id === "string") into.set(id, record);
  for (const value of Object.values(record)) collectNodesById(value, into);
}

/** A bare `{"@id": "..."}` reference has nothing useful of its own besides that key (and maybe
 *  `@type`) — an inline offer object already carries its own `price`/`priceCurrency` and needs no
 *  lookup at all. */
function resolveReference(
  value: unknown,
  idIndex: Map<string, Record<string, unknown>>,
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = record["@id"];
  if (typeof id === "string" && !("price" in record) && !("priceCurrency" in record)) {
    return idIndex.get(id) ?? null;
  }
  return record;
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** schema.org `availability` is a full URL (`https://schema.org/OutOfStock`) — only the trailing
 *  segment is the actual enum value worth comparing. */
function availabilityTail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const segment = value.trim().split("/").pop();
  return segment ? segment : null;
}

const UNAVAILABLE = new Set(["OutOfStock", "Discontinued", "SoldOut"]);

/**
 * Resolves a listing node's `offers` — one inline `Offer`, an array of them (real sites commonly
 * list several rate/cabin variants this way), or a bare `@id` reference — down to a single "starting
 * from" figure: the cheapest offer that isn't declared out of stock. Never the first offer blindly,
 * and never one schema.org itself says isn't currently bookable (rules doc §28: "старые цены;
 * устаревшие Offer").
 */
function resolveOffers(
  node: Record<string, unknown>,
  idIndex: Map<string, Record<string, unknown>>,
): { price: number | null; currency: string | null } {
  const raw = node.offers;
  if (raw === undefined || raw === null) return { price: null, currency: null };

  const available = (Array.isArray(raw) ? raw : [raw])
    .map((entry) => resolveReference(entry, idIndex))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      price: parsePrice(entry.price),
      currency: typeof entry.priceCurrency === "string" ? entry.priceCurrency.toUpperCase() : null,
      available: !UNAVAILABLE.has(availabilityTail(entry.availability) ?? ""),
    }))
    .filter((offer): offer is { price: number; currency: string | null; available: boolean } => {
      return offer.price !== null && offer.available;
    });

  if (available.length === 0) return { price: null, currency: null };
  const cheapest = available.reduce((min, offer) => (offer.price < min.price ? offer : min));
  return { price: cheapest.price, currency: cheapest.currency };
}

/**
 * Every named, non-site-wide node in the document that resolves to a usable price — walked with the
 * same shape as `findFirstNamedNode` (array / object / `@graph`), but collecting every match instead
 * of stopping at the first. Used only to detect the case rules doc §28 calls out: two different
 * `Product`-like blocks (duplicated markup, a stale cached fragment) stating different prices for
 * what looks like the same listing.
 */
function collectPricedListingPrices(
  node: unknown,
  idIndex: Map<string, Record<string, unknown>>,
  into: { price: number; currency: string | null }[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPricedListingPrices(item, idIndex, into);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  if (!isNonListingNode(record) && typeof record.name === "string" && record.name.trim()) {
    const offer = resolveOffers(record, idIndex);
    if (offer.price !== null) into.push({ price: offer.price, currency: offer.currency });
  }
  if ("@graph" in record) collectPricedListingPrices(record["@graph"], idIndex, into);
}

/**
 * Pulls basic listing fields (name/description/image/price) off the first JSON-LD node that
 * declares a `name` and isn't a known site-wide/organizational type (`NON_LISTING_TYPES`) —
 * deliberately not filtered to a positive `@type` allowlist (schema.org has no dedicated "boat"
 * type, and site owners rarely tag charter listings precisely as `Product`), so this trusts "has a
 * name, and isn't clearly about the site itself" as the signal that a node describes the thing the
 * page is about. Returns `null` when no page-wide JSON-LD carries such a name at all, which is a
 * fact about the page, not a failure.
 */
export function extractJsonLdFields(html: string): JsonLdFields | null {
  // Parsed up front, across every block on the page — `@id` references and the price-conflict scan
  // below must see the whole page's JSON-LD, not just whichever single `<script>` tag happens to
  // contain the primary listing node (real sites routinely split Organization/Product/Offer across
  // several separate blocks, as the "skips a site-wide Organization" test above already relies on).
  const parsedBlocks: unknown[] = [];
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    try {
      parsedBlocks.push(JSON.parse(match[1]));
    } catch {
      continue;
    }
  }
  if (parsedBlocks.length === 0) return null;

  let primaryNode: Record<string, unknown> | null = null;
  for (const parsed of parsedBlocks) {
    primaryNode = findFirstNamedNode(parsed);
    if (primaryNode) break;
  }
  if (!primaryNode) return null;

  const idIndex = new Map<string, Record<string, unknown>>();
  for (const parsed of parsedBlocks) collectNodesById(parsed, idIndex);

  const allPrices: { price: number; currency: string | null }[] = [];
  for (const parsed of parsedBlocks) collectPricedListingPrices(parsed, idIndex, allPrices);
  const distinctPrices = new Set(allPrices.map((offer) => `${offer.price}:${offer.currency ?? ""}`));
  const priceConflict = distinctPrices.size > 1;

  const offer = priceConflict ? { price: null, currency: null } : resolveOffers(primaryNode, idIndex);

  return {
    name: firstString(primaryNode.name),
    description: firstString(primaryNode.description),
    image: firstString(primaryNode.image),
    price: offer.price,
    currency: offer.currency,
    priceConflict,
  };
}
