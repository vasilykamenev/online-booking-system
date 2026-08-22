import * as cheerio from "cheerio";

/**
 * Deterministic extraction for a brilions.com vessel detail page (spec §11's first non-API tier:
 * HTML selectors, tried before AI extraction). Everything here was built against real markup
 * fetched during integration research (2026-08-21) — the ACF field list, the `<b>Порт:</b>`
 * pattern, and the gallery structure are all observed, not guessed.
 *
 * What this module does *not* attempt: the free-text amenities/crew list (spec's own example of
 * something structured extraction can't reliably parse — see `ai-extract.ts`), and price (there
 * is none published anywhere on the site).
 */

export interface DeterministicExtraction {
  name: string | null;
  vesselTypeRaw: string | null;
  city: string | null;
  year: number | null;
  lengthMeters: number | null;
  guests: number | null;
  cabins: number | null;
  description: string | null;
  images: string[];
  /** The free-text amenities `<li>` items, joined — raw input for `ai-extract.ts`. Empty when the
   *  page has no such section (e.g. a bare-bones fishing-charter listing), which is a fact about
   *  the page, not a failure. */
  amenitiesText: string;
}

/** RU and EN label spellings observed on real pages, mapped to a canonical field. Case-sensitive on
 *  purpose — cheerio gives us the literal rendered text, and both locales consistently capitalize
 *  these the same way. */
const FIELD_LABELS: Record<string, keyof Pick<DeterministicExtraction, "guests" | "lengthMeters" | "cabins" | "year">> = {
  "Максимум гостей": "guests",
  "Maximum guests": "guests",
  "Длина яхты": "lengthMeters",
  Length: "lengthMeters",
  Каюты: "cabins",
  Cabins: "cabins",
  "Год постройки": "year",
  "Year of construction": "year",
};

/** Filenames that show up in the gallery-selector's match set but are site chrome, not vessel photos. */
const NON_PHOTO_IMAGE_PATTERN = /logo|tursab|znak|brilions_r/i;
const MAX_GALLERY_IMAGES = 8;

function parseNumericValue(raw: string): number | null {
  const value = Number(raw.replace(",", ".").trim());
  return Number.isFinite(value) ? value : null;
}

export function extractDeterministic(html: string): DeterministicExtraction {
  const $ = cheerio.load(html);

  const result: DeterministicExtraction = {
    name: null,
    vesselTypeRaw: null,
    city: null,
    year: null,
    lengthMeters: null,
    guests: null,
    cabins: null,
    description: null,
    images: [],
    amenitiesText: "",
  };

  const h1 = $("h1").first().text().trim();
  if (h1) result.name = h1;

  $(".acf-field").each((_, el) => {
    const label = $(el).find(".acf-label").text().replace(/:\s*$/, "").trim();
    const field = FIELD_LABELS[label];
    if (!field) return;
    const value = parseNumericValue($(el).find(".acf-value").text());
    if (value !== null) result[field] = value;
  });

  $(".yacht-meta-item").each((_, el) => {
    const text = $(el).text();
    const match = /^\s*(?:Тип|Type)\s*:\s*(.+)$/.exec(text.trim());
    if (match) result.vesselTypeRaw = match[1].trim();
  });

  // The port/city is a `<b>Порт:</b><span>…</span>` pair, not an `.acf-field` — a separate widget
  // on the page, confirmed present (with its English "Port:" equivalent) on every fetched sample.
  $("b").each((_, el) => {
    const label = $(el).text().trim();
    if (!/^(Порт|Port)\s*:$/.test(label)) return;
    const value = $(el).parent().text().replace(label, "").trim();
    if (value) result.city = value;
  });

  const ogDescription = $('meta[property="og:description"]').attr("content")?.trim();
  if (ogDescription) result.description = ogDescription;

  const images = new Set<string>();
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim();
  if (ogImage) images.add(ogImage);
  $(".swiper-slide img, .gallery-item img, .elementor-image-carousel img").each((_, el) => {
    if (images.size >= MAX_GALLERY_IMAGES) return;
    const src = ($(el).attr("data-lazy-src") ?? $(el).attr("src") ?? "").trim();
    if (/wp-content\/uploads/.test(src) && !NON_PHOTO_IMAGE_PATTERN.test(src)) images.add(src);
  });
  result.images = [...images];

  // The `data-start` attribute is a leftover artifact from whatever authoring tool wrote the page
  // copy — not semantic markup — but it's the one reliable way found to isolate the amenities
  // list from the rest of the page's prose without keying off Russian/English wording.
  result.amenitiesText = $("li[data-start]")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .join(" ");

  return result;
}
