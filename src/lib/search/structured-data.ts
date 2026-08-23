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

/**
 * Extracts every `@type` declared across a page's `<script type="application/ld+json">` blocks.
 * A malformed block is skipped, not fatal — one broken script tag must not hide data in the others.
 */
export function extractJsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  const scriptPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    try {
      collectTypes(JSON.parse(match[1]), types);
    } catch {
      continue;
    }
  }
  return [...types];
}
