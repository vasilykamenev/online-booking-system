import { currencyCodes } from "@/lib/currencies";
import {
  searchCriteriaSchema,
  type CrewType,
  type PriceUnit,
  type SearchCriteria,
} from "@/lib/search/criteria";
import { containsTerm, normalizeForMatch, parseLooseNumber, stem } from "@/lib/search/text";
import type { SearchVocabulary, VocabularyEntry } from "@/lib/search/vocabulary";

/**
 * `SearchQueryInterpreter`'s deterministic half (spec §4).
 *
 * It exists for two reasons beyond cost. First, graceful degradation: without an API key, or when
 * the model call fails or times out, a global search must still return something useful rather
 * than an error page. Second, testability — spec §2's "AI понимает, код контролирует процесс"
 * only holds if the process is verifiable without a network round trip, so every rule here is a
 * pure function under unit test.
 *
 * It is deliberately conservative. Where a rule can't be sure, it emits `null` and lets the AI
 * interpreter (or the user's own chip edits) fill the gap — never a guess (spec §4).
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "₽": "RUB",
  "¥": "JPY",
  "₺": "TRY",
  "₴": "UAH",
};

/**
 * Word stems that identify what a preceding number counts. Deliberately excludes Russian "мест"
 * (places) from `guests`: it stems to "мес", colliding with "месяц" (month), and "3 месяца" being
 * read as "3 guests" is a worse failure than not recognising "6 мест".
 */
const UNIT_STEMS = {
  guests: ["человек", "чел", "гост", "персон", "пассажир", "people", "person", "guest", "pax", "passenger"],
  cabins: ["кают", "cabin", "stateroom"],
  hours: ["час", "hour"],
  days: ["дня", "день", "дней", "сутки", "суток", "day", "night", "ноч"],
  weeks: ["недел", "week"],
  months: ["месяц", "month"],
} as const;

/** Phrases that mark the following amount as a floor rather than a ceiling. */
const MIN_MARKERS = ["от", "from", "минимум", "min", "starting"];

const CAPTAIN_MARKERS = ["капитан", "captain", "skipper", "шкипер", "crewed", "с капитаном"];
const CREW_MARKERS = ["экипаж", "crew", "команд", "стюард", "steward"];
/** Explicit "no crew" phrasing — `crewType` must never default to `BAREBOAT` just because neither
 *  captain nor crew was mentioned; that's simply "unstated", not "stated as bareboat". */
const BAREBOAT_MARKERS = ["bareboat", "без экипажа", "своими силами", "без капитана"];

/**
 * Spelled-out small numbers, so "two week survey" and "две недели" are read as quantities.
 *
 * Without this the bare-week fallback below fires and reports *seven days* for a two-week trip —
 * asserting a wrong duration rather than admitting it didn't understand, which is the one failure
 * mode this whole module is built to avoid. Unlike months and currencies, there is no `Intl` API
 * for spelled-out numerals, so this list is unavoidable; it is linguistic data, not a business
 * dimension, so it doesn't fall under CLAUDE.md §9's "keep it in the reference tables" rule.
 */
const WORD_NUMERALS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  один: 1, одну: 1, одна: 1, два: 2, две: 2, двух: 2, три: 3, трех: 3, "трёх": 3,
  четыре: 4, четырех: 4, "четырёх": 4, пять: 5, пяти: 5, шесть: 6, шести: 6,
  семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10,
};

/**
 * Rewrites numeral words as digits, right-padding with spaces so the result is the same length as
 * the input. Length parity matters: consumed spans are recorded as index ranges into this string
 * and later blanked out of the original query, so any shift would corrupt every later extraction.
 */
function substituteWordNumerals(text: string): string {
  return text.replace(/\p{L}+/gu, (word) => {
    const value = WORD_NUMERALS[normalizeForMatch(word)];
    if (value === undefined) return word;
    return String(value).padEnd(word.length, " ");
  });
}

interface Range {
  start: number;
  end: number;
}

/** Replaces consumed spans with spaces so a number can never be counted twice. */
function blankRanges(text: string, ranges: Range[]): string {
  let result = text;
  for (const { start, end } of ranges) {
    result = result.slice(0, start) + " ".repeat(end - start) + result.slice(end);
  }
  return result;
}

/**
 * Month names for every configured locale, keyed by stem. Generated through `Intl` rather than
 * listed, so adding a locale to `routing` extends month recognition for free.
 */
function buildMonthNames(locales: readonly string[]): { name: string; month: number }[] {
  const names: { name: string; month: number }[] = [];
  for (const locale of locales) {
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
    } catch {
      continue; // An unsupported locale tag simply contributes no month names.
    }
    for (let index = 0; index < 12; index += 1) {
      names.push({ name: normalizeForMatch(formatter.format(new Date(Date.UTC(2001, index, 15)))), month: index + 1 });
    }
  }
  return names;
}

/**
 * Scores how well an inflected word matches a nominative month name, or -1 for "not a match".
 * Russian declines months ("сентябрь" → "в сентябре"), so comparison is by shared prefix.
 *
 * The two-sided tolerance is what keeps that safe. Requiring the shared prefix to cover all but
 * two characters *of the word as well as of the month* rejects "marina" against "march" (shares
 * only "mar", four short of the word) while still accepting "сентябре" against "сентябрь". A
 * one-sided rule would let every query mentioning a marina acquire a phantom March.
 */
function monthMatchScore(word: string, monthName: string): number {
  if (word === monthName) return monthName.length + 1;

  let shared = 0;
  while (shared < word.length && shared < monthName.length && word[shared] === monthName[shared]) {
    shared += 1;
  }
  if (shared < 2) return -1;
  if (shared < monthName.length - 2 || shared < word.length - 2) return -1;
  return shared;
}

/**
 * Picks the single best month across every word and every locale's month names. Scanning for the
 * best rather than the first match matters for ambiguous stems: "мая" shares two characters with
 * both "март" and "май", and only the length tiebreak picks May.
 */
function findMonth(words: string[], monthNames: { name: string; month: number }[]): number | null {
  let best: { month: number; score: number; lengthDelta: number } | null = null;

  for (const word of words) {
    for (const { name, month } of monthNames) {
      const score = monthMatchScore(word, name);
      if (score < 0) continue;
      const lengthDelta = Math.abs(word.length - name.length);
      if (!best || score > best.score || (score === best.score && lengthDelta < best.lengthDelta)) {
        best = { month, score, lengthDelta };
      }
    }
  }
  return best?.month ?? null;
}

const NEXT_MONTH_PHRASES = ["next month", "следующий месяц", "будущий месяц"];
const THIS_MONTH_PHRASES = ["this month", "текущий месяц", "этот месяц"];

/**
 * "next month"/"следующий месяц" or "this month"/"этот месяц" resolved against `today` — the one
 * relative-date phrase common enough in real queries ("rent yacht on next month") to warrant
 * handling without an AI call, which is this module's whole reason for existing (see the doc
 * comment at the top: a global search must still return something useful when the AI path is
 * unavailable). Without this, a query naming no *literal* month falls straight through to
 * `date: null` — silently dropping the one criterion the user was most specific about, exactly the
 * failure this module exists to avoid elsewhere (spec §4: never guess, but also never just drop
 * something the query actually stated).
 *
 * Deliberately narrow: no other relative phrase ("next week", "this weekend") is resolved here —
 * `SearchCriteria.date` has no week-level granularity to put one in without inventing a wrong month
 * near a month boundary, and a literal month name (`findMonth`, called first) always wins when one
 * is present — this only runs when nothing literal was found.
 */
function resolveRelativeMonth(query: string, today: Date): { month: number; year: number } | null {
  if (NEXT_MONTH_PHRASES.some((phrase) => containsTerm(query, phrase))) {
    const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    return { month: next.getUTCMonth() + 1, year: next.getUTCFullYear() };
  }
  if (THIS_MONTH_PHRASES.some((phrase) => containsTerm(query, phrase))) {
    return { month: today.getUTCMonth() + 1, year: today.getUTCFullYear() };
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds the currency the query talks about, if any, and where it was mentioned. */
function findCurrency(text: string, locales: readonly string[]): { code: string; range: Range } | null {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    const index = text.indexOf(symbol);
    if (index !== -1) return { code, range: { start: index, end: index + symbol.length } };
  }

  // Uppercase-only on purpose. Several ISO codes are also ordinary lowercase English words — "try"
  // (TRY), "all" (ALL), "top" (TOP) — and matching those would turn "I'll try September" into a
  // Turkish-lira budget. Real queries write the code in caps; lowercase is the AI path's job.
  const isoMatch = [...text.matchAll(/\b([A-Z]{3})\b/g)].find((match) =>
    (currencyCodes as readonly string[]).includes(match[1]),
  );
  if (isoMatch?.index !== undefined) {
    return {
      code: isoMatch[1],
      range: { start: isoMatch.index, end: isoMatch.index + isoMatch[1].length },
    };
  }

  // Single-word currency names ("евро", "euro"). Multi-word ones ("доллар США", "US Dollar") are
  // left to the AI interpreter rather than guessed at from a fragment like "США". Matched against
  // the original text, not a normalized copy, so the returned range addresses real indices.
  for (const locale of locales) {
    let display: Intl.DisplayNames;
    try {
      display = new Intl.DisplayNames([locale], { type: "currency" });
    } catch {
      continue;
    }
    for (const code of currencyCodes) {
      const name = display.of(code);
      if (!name || name.trim().includes(" ") || name.length < 3) continue;
      // A trailing `\p{L}*` absorbs inflection ("евро" → "евром", "dollar" → "dollars").
      const match = new RegExp(`\\b${escapeRegExp(name)}\\p{L}*`, "iu").exec(text);
      if (match?.index !== undefined) {
        return { code, range: { start: match.index, end: match.index + match[0].length } };
      }
    }
  }
  return null;
}

/** Extracts a budget, preferring an amount adjacent to the currency mention. */
function extractPrice(
  text: string,
  locales: readonly string[],
): { price: { min: number | null; max: number | null; currency: string | null } | null; ranges: Range[] } {
  const currency = findCurrency(text, locales);
  const numbers = [...text.matchAll(/\d[\d\s.,]*\d|\d/g)];
  if (numbers.length === 0) return { price: null, ranges: [] };

  let chosen: { value: number; range: Range } | null = null;

  if (currency) {
    // "5000 EUR" and "€5000" are both common — take whichever number sits closest to the symbol.
    const nearby = numbers
      .filter((match) => match.index !== undefined)
      .map((match) => ({
        value: parseLooseNumber(match[0]),
        range: { start: match.index!, end: match.index! + match[0].length },
      }))
      .filter((candidate): candidate is { value: number; range: Range } => candidate.value !== null)
      .map((candidate) => ({
        ...candidate,
        distance: Math.min(
          Math.abs(candidate.range.start - currency.range.end),
          Math.abs(currency.range.start - candidate.range.end),
        ),
      }))
      .filter((candidate) => candidate.distance <= 12)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearby) chosen = { value: nearby.value, range: nearby.range };
  }

  if (!chosen) {
    // No currency mentioned: only trust an amount that a budget word introduces, otherwise a
    // guest count would be read as a price.
    const budgetMatch = /(?:бюджет|budget|до|под|максимум|max(?:imum)?|up to)\s*([\d\s.,]+\d|\d)/iu.exec(text);
    if (budgetMatch?.index !== undefined) {
      const value = parseLooseNumber(budgetMatch[1]);
      if (value !== null && value >= 100) {
        const start = budgetMatch.index + budgetMatch[0].indexOf(budgetMatch[1]);
        chosen = { value, range: { start, end: start + budgetMatch[1].length } };
      }
    }
  }

  if (!chosen) {
    return currency ? { price: { min: null, max: null, currency: currency.code }, ranges: [currency.range] } : { price: null, ranges: [] };
  }

  const before = normalizeForMatch(text.slice(Math.max(0, chosen.range.start - 14), chosen.range.start));
  const isMinimum = MIN_MARKERS.some((marker) => containsTerm(before, marker));

  return {
    price: {
      min: isMinimum ? chosen.value : null,
      max: isMinimum ? null : chosen.value,
      currency: currency?.code ?? null,
    },
    ranges: currency ? [chosen.range, currency.range] : [chosen.range],
  };
}

const PRICE_UNIT_STEMS: Record<Exclude<PriceUnit, "TRIP">, readonly string[]> = {
  HOUR: UNIT_STEMS.hours,
  DAY: UNIT_STEMS.days,
  WEEK: UNIT_STEMS.weeks,
  MONTH: UNIT_STEMS.months,
};

/**
 * Finds a rate marker ("за неделю", "per week", "/week") directly following a stated price, and
 * says how the budget is metered. Deliberately narrow — only fires immediately after `priceEnd`,
 * gated on an explicit rate word ("за"/"per"/"/"): without that gate, any unrelated later mention
 * of a day/week/month ("бюджет 3000 EUR, следующая неделя свободна") would be misread as a rate.
 *
 * Consuming the matched span is what keeps this from double-counting: without it, "3000 EUR за
 * неделю" would *also* satisfy the bare-duration fallback below and produce a phantom 7-day trip
 * that was never actually stated (only a weekly rate was).
 */
function extractPriceUnit(text: string, priceEnd: number): { unit: PriceUnit | null; range: Range | null } {
  const window = text.slice(priceEnd, priceEnd + 24);
  const match = /^\s*(?:за|per|\/)\s*([\p{L}]+)/iu.exec(window);
  if (!match || match.index === undefined) return { unit: null, range: null };

  const wordStem = stem(match[1]);
  for (const [unit, stems] of Object.entries(PRICE_UNIT_STEMS) as [PriceUnit, readonly string[]][]) {
    const matches = stems.some((candidate) => {
      const candidateStem = stem(candidate);
      return wordStem.startsWith(candidateStem) || candidateStem.startsWith(wordStem);
    });
    if (matches) {
      return { unit, range: { start: priceEnd + match.index, end: priceEnd + match.index + match[0].length } };
    }
  }
  return { unit: null, range: null };
}

/**
 * Length and radius get their own dedicated extraction, unlike guests/cabins/duration, which share
 * `extractNumberUnits`'s generic stem-matching. Their unit words are too short to matching safely
 * there: "м" (meter) is a character-for-character prefix of half the Cyrillic alphabet under
 * stem-prefix comparison, and "км" (kilometer) collides the same way with "кают" (cabins) — both
 * would silently steal numbers meant for an unrelated field. Exact alternation with an explicit
 * non-letter lookahead avoids that entirely.
 */
const LENGTH_UNIT = "(?:м|метр(?:а|ов|ы)?|meters?|metres?)(?![\\p{L}])";
const RADIUS_UNIT = "(?:км|километр\\w*|kms?|kilometers?|kilometres?)(?![\\p{L}])";

/** "12-14 м" → {min:12, max:14}; "от 12 м" → {min:12, max:null}; a bare "14 м" → {min:null, max:14},
 *  mirroring `extractPrice`'s min/max-marker convention. */
function extractLength(text: string): { length: { min: number | null; max: number | null } | null; range: Range | null } {
  const rangeRe = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:[-–—]|to|до)\\s*(\\d+(?:[.,]\\d+)?)\\s*${LENGTH_UNIT}`, "iu");
  const rangeMatch = rangeRe.exec(text);
  if (rangeMatch?.index !== undefined) {
    const min = parseLooseNumber(rangeMatch[1]);
    const max = parseLooseNumber(rangeMatch[2]);
    return {
      length: min !== null || max !== null ? { min, max } : null,
      range: { start: rangeMatch.index, end: rangeMatch.index + rangeMatch[0].length },
    };
  }

  const singleRe = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${LENGTH_UNIT}`, "iu");
  const singleMatch = singleRe.exec(text);
  if (singleMatch?.index !== undefined) {
    const value = parseLooseNumber(singleMatch[1]);
    if (value === null) return { length: null, range: null };
    const before = normalizeForMatch(text.slice(Math.max(0, singleMatch.index - 14), singleMatch.index));
    const isMinimum = MIN_MARKERS.some((marker) => containsTerm(before, marker));
    return {
      length: isMinimum ? { min: value, max: null } : { min: null, max: value },
      range: { start: singleMatch.index, end: singleMatch.index + singleMatch[0].length },
    };
  }

  return { length: null, range: null };
}

/** "50 км" / "50 km" → 50. Resolving *which* point that radius centers on is not this module's
 *  job (see `criteria.ts`'s doc comment on `location.latitude`) — a stated place name is still
 *  picked up independently by the vocabulary matching below. */
function extractRadiusKm(text: string): { radiusKm: number | null; range: Range | null } {
  const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${RADIUS_UNIT}`, "iu");
  const match = re.exec(text);
  if (match?.index === undefined) return { radiusKm: null, range: null };
  const value = parseLooseNumber(match[1]);
  if (value === null) return { radiusKm: null, range: null };
  return { radiusKm: value, range: { start: match.index, end: match.index + match[0].length } };
}

interface NumberUnit {
  /** Upper bound of a range ("8-10 человек" → 10): the vessel must fit the whole group. */
  value: number;
  unit: keyof typeof UNIT_STEMS;
  range: Range;
}

/** Pairs each number with the unit word that follows it. */
function extractNumberUnits(text: string): NumberUnit[] {
  const found: NumberUnit[] = [];
  const pattern = /(\d+)\s*(?:[-–—]|\s+до\s+|\s+to\s+)?\s*(\d+)?\s*([\p{L}]+)/gu;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const [full, low, high, word] = match;
    const wordStem = stem(word);
    const unit = (Object.keys(UNIT_STEMS) as (keyof typeof UNIT_STEMS)[]).find((key) =>
      UNIT_STEMS[key].some((candidate) => {
        const candidateStem = stem(candidate);
        return wordStem.startsWith(candidateStem) || candidateStem.startsWith(wordStem);
      }),
    );
    if (!unit) continue;

    const value = Number(high ?? low);
    if (!Number.isFinite(value) || value <= 0) continue;
    found.push({ value, unit, range: { start: match.index, end: match.index + full.length } });
  }
  return found;
}

/** Picks the vocabulary entry whose longest matching alias wins, so "Split" loses to "Split Marina". */
function bestVocabularyMatch(text: string, entries: VocabularyEntry[]): string | null {
  let best: { value: string; length: number } | null = null;
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (!containsTerm(text, alias)) continue;
      const length = normalizeForMatch(alias).length;
      if (!best || length > best.length) best = { value: entry.value, length };
    }
  }
  return best?.value ?? null;
}

export interface DeterministicInterpretationInput {
  query: string;
  vocabulary: SearchVocabulary;
  /** Locales whose month and currency names should be recognised — pass `routing.locales`. */
  locales: readonly string[];
  /** Reference date for resolving "next month"/"this month" — injectable for tests, defaults to
   *  now. Mirrors `interpretQuery`'s own `today` parameter on the AI path. */
  today?: Date;
}

export function interpretQueryDeterministic({
  query,
  vocabulary,
  locales,
  today = new Date(),
}: DeterministicInterpretationInput): SearchCriteria {
  const consumed: Range[] = [];

  const { price, ranges: priceRanges } = extractPrice(query, locales);
  consumed.push(...priceRanges);

  // A rate marker ("за неделю") only makes sense directly after the price itself was found —
  // scanning for one first, before anything else consumes text, is what lets it see "3000 EUR за
  // неделю" as one phrase rather than two independent mentions.
  let priceUnit: PriceUnit | null = null;
  if (price) {
    const priceEnd = Math.max(...priceRanges.map((range) => range.end));
    const found = extractPriceUnit(query, priceEnd);
    priceUnit = found.unit;
    if (found.range) consumed.push(found.range);
  }

  const { length, range: lengthRange } = extractLength(blankRanges(query, consumed));
  if (lengthRange) consumed.push(lengthRange);

  const { radiusKm, range: radiusRange } = extractRadiusKm(blankRanges(query, consumed));
  if (radiusRange) consumed.push(radiusRange);

  const afterPrice = substituteWordNumerals(blankRanges(query, consumed));
  const numberUnits = extractNumberUnits(afterPrice);
  consumed.push(...numberUnits.map((entry) => entry.range));

  const guests = numberUnits.find((entry) => entry.unit === "guests")?.value ?? null;
  const cabins = numberUnits.find((entry) => entry.unit === "cabins")?.value ?? null;

  // Durations are normalized to days (spec §4's example turns "на неделю" into 7 DAY), which keeps
  // every downstream comparison on one unit. Hours stay hours — they aren't day-expressible.
  const hours = numberUnits.find((entry) => entry.unit === "hours");
  const days = numberUnits.find((entry) => entry.unit === "days");
  const weeks = numberUnits.find((entry) => entry.unit === "weeks");
  const monthsLong = numberUnits.find((entry) => entry.unit === "months");

  let duration: { value: number; unit: "HOUR" | "DAY" } | null = null;
  if (days) duration = { value: days.value, unit: "DAY" };
  else if (weeks) duration = { value: weeks.value * 7, unit: "DAY" };
  else if (monthsLong) duration = { value: monthsLong.value * 30, unit: "DAY" };
  else if (hours) duration = { value: hours.value, unit: "HOUR" };
  // "на неделю" carries a duration with no number attached. Matched via `containsTerm`, not a
  // `\b`-anchored regex: JavaScript's `\b` is defined against ASCII `\w`, so `\bнедел` never
  // matches — there is no word boundary before a Cyrillic letter. Checked against `afterPrice`
  // (already blanked of anything `extractPriceUnit` consumed), not the raw query — otherwise
  // "3000 EUR за неделю" would double-count as *both* a weekly rate and a separate 7-day trip
  // that was never actually stated.
  else if (containsTerm(afterPrice, "неделя") || containsTerm(afterPrice, "week")) {
    duration = { value: 7, unit: "DAY" };
  }

  const remaining = blankRanges(query, consumed);

  // Dates: an explicit ISO pair wins; otherwise a month name gives a fuzzy period. A month with no
  // stated year stays year-less rather than assuming the current one (spec §4: no invented values).
  const isoDates = [...remaining.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  const words = normalizeForMatch(remaining).split(" ").filter(Boolean);
  const literalMonth = findMonth(words, buildMonthNames(locales));
  // Only consulted when no literal month name was found — an explicit month always wins over a
  // relative phrase.
  const relativeMonth = literalMonth === null ? resolveRelativeMonth(query, today) : null;
  const month = literalMonth ?? relativeMonth?.month ?? null;
  const yearMatch = /\b(20\d{2})\b/.exec(remaining);
  // A relative phrase resolves both month and year together — an explicit 4-digit year elsewhere
  // in the query still wins (checked first), same precedence as the literal-month case above.
  const year = yearMatch ? Number(yearMatch[1]) : (relativeMonth?.year ?? null);

  const bareboat = BAREBOAT_MARKERS.some((marker) => containsTerm(query, marker));
  // A bareboat marker ("без экипажа") contains the word "экипаж" itself, which `CREW_MARKERS`
  // would otherwise also match — checked and short-circuited first so "без экипажа" reads as "no
  // crew", not as a self-contradictory "no crew, crew required".
  const captainRequired = !bareboat && CAPTAIN_MARKERS.some((marker) => containsTerm(query, marker)) || null;
  const crewRequired = !bareboat && CREW_MARKERS.some((marker) => containsTerm(query, marker)) || null;
  // "Skippered" and "captain required" are the same request from the customer's side, so a
  // captain marker doubles as the `crewType` signal too — but only when the query didn't
  // explicitly say bareboat, which must win regardless of what else is mentioned.
  const crewType: CrewType | null = bareboat
    ? "BAREBOAT"
    : crewRequired
      ? "CREWED"
      : captainRequired
        ? "SKIPPERED"
        : null;

  // Every matching type, not just the first (Арх §5's `vesselTypes[]`) — "яхта или катамаран"
  // names two acceptable types, and picking one arbitrarily would silently exclude the other.
  const vesselTypes = vocabulary.vesselTypes
    .filter((entry) => entry.aliases.some((alias) => containsTerm(query, alias)))
    .map((entry) => entry.value);

  const amenities = vocabulary.features
    .filter((entry) => entry.aliases.some((alias) => containsTerm(query, alias)))
    .map((entry) => entry.value);
  // No reference vocabulary to match "diving"/"family holiday"-style phrases against yet (see
  // `criteria.ts`'s doc comment on `activities`) — the deterministic path leaves this to the AI
  // interpreter rather than guessing at free text with no controlled list to check it against.
  const activities: string[] = [];

  const country = bestVocabularyMatch(query, vocabulary.countries);
  const city = bestVocabularyMatch(query, vocabulary.cities);
  const marina = bestVocabularyMatch(query, vocabulary.marinas);

  // Leftover long words. Noise ("желательно") is tolerated: an unmatched keyword contributes
  // nothing to ranking, so a permissive filter costs precision nowhere.
  const matchedTerms = new Set(
    [country, city, marina, ...amenities].filter((value): value is string => value !== null).flatMap((value) =>
      normalizeForMatch(value).split(" "),
    ),
  );
  const keywords = [...new Set(normalizeForMatch(remaining).split(" "))]
    .filter((word) => word.length >= 5 && !/^\d+$/.test(word) && !matchedTerms.has(word))
    .slice(0, 8);

  return searchCriteriaSchema.parse({
    location: country || city || marina ? { country, city, marina, region: null } : null,
    date:
      isoDates.length > 0 || month !== null || year !== null
        ? {
            from: isoDates[0] ?? null,
            to: isoDates[1] ?? null,
            month,
            year,
            flexible: isoDates.length === 0 && month !== null ? true : null,
          }
        : null,
    capacity: guests !== null || cabins !== null ? { persons: guests, cabins } : null,
    price,
    priceUnit,
    duration,
    length,
    crew: captainRequired || crewRequired || crewType ? { captainRequired, crewRequired, crewType } : null,
    vesselTypes,
    amenities,
    activities,
    searchRadiusKm: radiusKm,
    keywords,
  });
}
