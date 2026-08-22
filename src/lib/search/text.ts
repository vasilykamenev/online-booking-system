/**
 * Text helpers shared by query interpretation, deduplication and ranking. Pure and locale-neutral:
 * they must behave identically for Russian and English input, since a single query can mix both.
 */

/**
 * Folds text to a comparable form: lowercase, no diacritics, single-spaced. NFKD followed by
 * stripping combining marks also normalizes Cyrillic "й"→"и" and "ё"→"е", which is exactly the
 * forgiveness we want when matching user prose against reference-table labels.
 */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * A prefix long enough to identify a word but short enough to survive inflection — Russian cases
 * ("сентябрь" → "в сентябре", "яхта" → "яхту") and English plurals both change only the tail.
 * Three characters is the floor so short words like "май" stay intact.
 */
export function stem(word: string): string {
  const normalized = normalizeForMatch(word);
  return normalized.slice(0, Math.max(3, normalized.length - 3));
}

/**
 * True when `haystack` contains `needle` as a whole word, comparing on stems so inflected forms
 * still match. Word-boundary aware to avoid "map" matching inside "marina".
 */
export function containsTerm(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeForMatch(needle);
  if (!normalizedNeedle) return false;

  const needleWords = normalizedNeedle.split(" ");
  const haystackWords = normalizeForMatch(haystack).split(" ");

  // Multi-word terms ("Cape Town", "Марина Каштела") must appear as a contiguous run.
  for (let start = 0; start + needleWords.length <= haystackWords.length; start += 1) {
    const matches = needleWords.every((word, offset) => {
      const candidate = haystackWords[start + offset];
      const wordStem = stem(word);
      return candidate === word || candidate.startsWith(wordStem);
    });
    if (matches) return true;
  }
  return false;
}

/** Parses "5 000", "5,000", "5.000" and "5000" into 5000; returns null for anything else. */
export function parseLooseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s ]/g, "");
  // A separator followed by exactly three digits is a thousands group, not a decimal point.
  const withoutGrouping = cleaned.replace(/[.,](?=\d{3}(?:\D|$))/g, "");
  const value = Number(withoutGrouping.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/**
 * Jaccard similarity over word sets, 0.0-1.0. Used by deduplication to compare vessel names
 * across sources where word order and punctuation differ ("Sun Odyssey 440" vs "Jeanneau Sun
 * Odyssey 440").
 */
export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(normalizeForMatch(a).split(" ").filter(Boolean));
  const right = new Set(normalizeForMatch(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}
