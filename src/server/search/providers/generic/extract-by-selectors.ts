import * as cheerio from "cheerio";
import type { SelectorConfig } from "@/lib/validation/admin";
import type { GenericExtractedFields } from "./normalize";

/**
 * Deterministic tier 0 for the generic provider (docs/search-source-processing-strategies.md §1.1):
 * reads a page's fields via the admin-supplied `selectorConfig` instead of JSON-LD or AI, the same
 * "cheerio, pure function, no network" shape as `providers/brilions/extract.ts`. `name` unresolved
 * means the whole extraction is a miss — same convention `providers/generic/provider.ts` already
 * uses for its JSON-LD tier (`if (structured?.name)`).
 */

type StringField = keyof Pick<
  GenericExtractedFields,
  "name" | "description" | "image" | "vesselTypeRaw" | "country" | "city"
>;
type NumericField = keyof Pick<GenericExtractedFields, "guests" | "cabins">;

function readRaw($: cheerio.CheerioAPI, field: SelectorConfig["fields"][keyof SelectorConfig["fields"]]): string | null {
  if (!field) return null;
  const el = $(field.selector).first();
  if (el.length === 0) return null;

  const raw = field.attr ? el.attr(field.attr) : el.text();
  const value = raw?.trim();
  if (!value) return null;
  if (!field.regex) return value;

  // A malformed admin-authored pattern shouldn't blank a field that was otherwise found — fall back
  // to the unfiltered value rather than losing it.
  try {
    const match = new RegExp(field.regex).exec(value);
    return match?.[1]?.trim() || value;
  } catch {
    return value;
  }
}

function readString($: cheerio.CheerioAPI, config: SelectorConfig, field: StringField): string | null {
  return readRaw($, config.fields[field]);
}

function readNumeric($: cheerio.CheerioAPI, config: SelectorConfig, field: NumericField): number | null {
  const raw = readRaw($, config.fields[field]);
  if (raw === null) return null;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function extractBySelectors(html: string, config: SelectorConfig): GenericExtractedFields | null {
  const $ = cheerio.load(html);

  const name = readString($, config, "name");
  if (!name) return null;

  return {
    name,
    description: readString($, config, "description"),
    image: readString($, config, "image"),
    guests: readNumeric($, config, "guests"),
    cabins: readNumeric($, config, "cabins"),
    vesselTypeRaw: readString($, config, "vesselTypeRaw"),
    country: readString($, config, "country"),
    city: readString($, config, "city"),
  };
}
