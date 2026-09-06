import { describe, expect, it } from "vitest";
import { interpretQueryDeterministic } from "./interpret-fallback";
import { withDistinctiveWordAliases, type SearchVocabulary } from "./vocabulary";
import { vesselTypeValues } from "@/lib/validation/search";

const LOCALES = ["en", "ru"] as const;

/** Mirrors what `buildSearchVocabulary` derives from `locations` / `amenities` / type labels. */
const vocabulary: SearchVocabulary = {
  countries: [
    { value: "Greece", aliases: ["Greece", "Греция"] },
    { value: "Croatia", aliases: ["Croatia", "Хорватия"] },
    { value: "Norway", aliases: ["Norway", "Норвегия"] },
  ],
  cities: [
    { value: "Athens", aliases: ["Athens", "Афины"] },
    { value: "Split", aliases: ["Split", "Сплит"] },
  ],
  marinas: [{ value: "Marina Kastela", aliases: ["Marina Kastela", "Марина Каштела"] }],
  cityCountries: { Athens: "Greece", Split: "Croatia" },
  vesselTypes: [
    { value: "MOTOR_YACHT", aliases: ["Yacht", "Яхта", "Моторная яхта"] },
    { value: "CATAMARAN", aliases: ["Catamaran", "Катамаран"] },
    { value: "EXPEDITION_YACHT", aliases: ["Expedition", "Экспедиция", "Экспедиционное судно"] },
    { value: "RESEARCH_VESSEL", aliases: ["Research vessel", "Исследовательское судно"] },
  ],
  features: [
    { value: "wifi", aliases: ["Wi-Fi", "Вайфай"] },
    { value: "diving", aliases: ["Diving", "Дайвинг"] },
  ],
};

function interpret(query: string, today?: Date) {
  return interpretQueryDeterministic({ query, vocabulary, locales: LOCALES, today });
}

describe("interpretQueryDeterministic — spec §4 worked examples", () => {
  it("interprets the Greek charter example from the spec", () => {
    const criteria = interpret(
      "Ищу моторную яхту в Греции на 6 человек в сентябре, примерно на неделю, бюджет до 5000 EUR. Желательно с капитаном.",
    );

    expect(criteria.location?.country).toBe("Greece");
    expect(criteria.capacity?.persons).toBe(6);
    expect(criteria.date?.month).toBe(9);
    expect(criteria.duration).toEqual({ value: 7, unit: "DAY" });
    // 5000 EUR stated in major units becomes minor units at the interpretation boundary.
    expect(criteria.price?.maxMinor).toBe(500_000);
    expect(criteria.price?.currency).toBe("EUR");
    expect(criteria.crew?.captainRequired).toBe(true);
    expect(criteria.crew?.crewType).toBe("SKIPPERED");
    expect(criteria.vesselTypes).toEqual(["MOTOR_YACHT"]);
  });

  it("interprets the Svalbard expedition example, taking the top of a guest range", () => {
    const criteria = interpret(
      "Нужно судно для экспедиции на Шпицберген летом, 8-10 человек, желательно возможность проживания на борту.",
    );

    // The vessel has to fit the whole party, so a range resolves to its upper bound.
    expect(criteria.capacity?.persons).toBe(10);
    expect(criteria.vesselTypes).toEqual(["EXPEDITION_YACHT"]);
    // Nothing in the text names a country in our reference data — it must not invent one.
    expect(criteria.location).toBeNull();
    expect(criteria.price).toBeNull();
  });
});

describe("interpretQueryDeterministic — never invents criteria (spec §4)", () => {
  it("returns all-null criteria for a query with nothing recognisable", () => {
    const criteria = interpret("что-нибудь интересное");
    expect(criteria.location).toBeNull();
    expect(criteria.capacity).toBeNull();
    expect(criteria.price).toBeNull();
    expect(criteria.date).toBeNull();
    expect(criteria.vesselTypes).toEqual([]);
  });

  it("does not infer a year when only a month was named", () => {
    const criteria = interpret("яхта в сентябре");
    expect(criteria.date?.month).toBe(9);
    expect(criteria.date?.year).toBeNull();
  });

  it("does not read a bare number as a price without a currency or budget word", () => {
    const criteria = interpret("катамаран на 8 человек");
    expect(criteria.price).toBeNull();
    expect(criteria.capacity?.persons).toBe(8);
  });
});

// The reported bug: "rent yacht on next month" registered no date at all — the deterministic
// fallback only ever recognized a *literal* month name (findMonth), never a relative phrase, so a
// query naming no explicit month silently lost the one criterion it was clearest about whenever
// the AI path was unavailable (missing/invalid API key, timeout, rate limit — query-interpreter.ts
// falls back here on any of those).
describe("interpretQueryDeterministic — relative month", () => {
  const TODAY = new Date(Date.UTC(2026, 7, 26)); // 2026-08-26, matches this project's "today"

  it("resolves 'next month' relative to today", () => {
    const criteria = interpret("rent yacht on next month", TODAY);
    expect(criteria.date?.month).toBe(9);
    expect(criteria.date?.year).toBe(2026);
    expect(criteria.date?.flexible).toBe(true);
  });

  it("resolves 'следующий месяц' the same way, in Russian", () => {
    const criteria = interpret("аренда яхты на следующий месяц", TODAY);
    expect(criteria.date?.month).toBe(9);
    expect(criteria.date?.year).toBe(2026);
  });

  it("resolves 'this month' to the current month and year", () => {
    const criteria = interpret("yacht available this month", TODAY);
    expect(criteria.date?.month).toBe(8);
    expect(criteria.date?.year).toBe(2026);
  });

  it("resolves 'этот месяц', in Russian", () => {
    const criteria = interpret("яхта на этот месяц", TODAY);
    expect(criteria.date?.month).toBe(8);
    expect(criteria.date?.year).toBe(2026);
  });

  it("rolls over into next year when 'next month' is December", () => {
    const december = new Date(Date.UTC(2026, 11, 15)); // 2026-12-15
    const criteria = interpret("yacht next month", december);
    expect(criteria.date?.month).toBe(1);
    expect(criteria.date?.year).toBe(2027);
  });

  it("prefers an explicit month name over a relative phrase in the same query", () => {
    const criteria = interpret("yacht next month, actually in December", TODAY);
    expect(criteria.date?.month).toBe(12);
  });

  it("defaults to the real current date when none is injected", () => {
    // No fixed `today` — just confirms the parameter is optional and the call doesn't throw.
    const criteria = interpretQueryDeterministic({ query: "yacht next month", vocabulary, locales: LOCALES });
    expect(criteria.date?.month).not.toBeNull();
  });
});

describe("interpretQueryDeterministic — money", () => {
  it("reads a symbol-prefixed amount", () => {
    const criteria = interpret("yacht in Croatia up to €4500");
    expect(criteria.price?.maxMinor).toBe(450_000);
    expect(criteria.price?.currency).toBe("EUR");
  });

  it("reads a thousands-separated amount", () => {
    const criteria = interpret("бюджет до 12 000 EUR");
    expect(criteria.price?.maxMinor).toBe(1_200_000);
  });

  it("treats an amount introduced by a minimum marker as a floor, not a ceiling", () => {
    const criteria = interpret("яхта от 3000 EUR");
    expect(criteria.price?.minMinor).toBe(300_000);
    expect(criteria.price?.maxMinor).toBeNull();
  });

  it("does not mistake a guest count for the budget when both are present", () => {
    const criteria = interpret("яхта на 6 человек, бюджет до 5000 EUR");
    expect(criteria.capacity?.persons).toBe(6);
    expect(criteria.price?.maxMinor).toBe(500_000);
  });

  it("ignores a lowercase ISO code that is also an ordinary English word", () => {
    // "try" is TRY (Turkish lira); reading it as a currency would corrupt the budget.
    const criteria = interpret("I want to try a catamaran for 4 guests");
    expect(criteria.price).toBeNull();
    expect(criteria.capacity?.persons).toBe(4);
  });
});

describe("interpretQueryDeterministic — durations", () => {
  it("normalizes weeks to days", () => {
    expect(interpret("аренда на 2 недели").duration).toEqual({ value: 14, unit: "DAY" });
  });

  it("keeps hours as hours, since they are not day-expressible", () => {
    expect(interpret("прогулка на 4 часа").duration).toEqual({ value: 4, unit: "HOUR" });
  });

  it("reads a bare 'на неделю' with no number", () => {
    expect(interpret("яхта на неделю").duration).toEqual({ value: 7, unit: "DAY" });
  });

  it("reads a spelled-out number rather than falling back to a single week", () => {
    // "two week survey" must not become seven days. Reporting a wrong duration is worse than
    // reporting none, since the user has no way to see that it was a guess.
    expect(interpret("research vessel for a two week survey").duration).toEqual({
      value: 14,
      unit: "DAY",
    });
  });

  it("reads a spelled-out Russian numeral, including an oblique form", () => {
    expect(interpret("аренда на две недели").duration).toEqual({ value: 14, unit: "DAY" });
    expect(interpret("яхта на пять дней").duration).toEqual({ value: 5, unit: "DAY" });
  });

  it("reads a spelled-out guest count", () => {
    expect(interpret("яхта на шесть человек").capacity?.persons).toBe(6);
  });

  it("does not let numeral substitution disturb other extraction", () => {
    // Numerals are padded to preserve string length, so location and price spans stay aligned.
    const criteria = interpret("яхта в Греции на две недели, бюджет до 5000 EUR");
    expect(criteria.location?.country).toBe("Greece");
    expect(criteria.price?.maxMinor).toBe(500_000);
    expect(criteria.duration).toEqual({ value: 14, unit: "DAY" });
  });

  it("does not confuse a month count with a guest count", () => {
    const criteria = interpret("экспедиция на 3 месяца");
    expect(criteria.capacity).toBeNull();
    expect(criteria.duration).toEqual({ value: 90, unit: "DAY" });
  });
});

describe("interpretQueryDeterministic — vocabulary matching", () => {
  it("prefers the most specific location match", () => {
    const criteria = interpret("яхта в Марина Каштела");
    expect(criteria.location?.marina).toBe("Marina Kastela");
  });

  it("matches inflected Russian forms against nominative reference labels", () => {
    expect(interpret("хочу яхту в Хорватии").location?.country).toBe("Croatia");
  });

  it("matches an English query against the same canonical value as a Russian one", () => {
    expect(interpret("yacht in Greece").location?.country).toBe(
      interpret("яхта в Греции").location?.country,
    );
  });

  it("collects requested amenities as slugs", () => {
    expect(interpret("катамаран с дайвингом и вайфаем").amenities).toEqual(
      expect.arrayContaining(["diving", "wifi"]),
    );
  });

  it("never populates activities — no reference vocabulary exists yet for them", () => {
    expect(interpret("катамаран для дайвинга").activities).toEqual([]);
  });

  it("does not read a marina name as the month of May", () => {
    // "may" shares a two-letter prefix with "marina"; a naive prefix match would invent May here.
    const criteria = interpret("yacht at Marina Kastela");
    expect(criteria.date).toBeNull();
  });
});

describe("interpretQueryDeterministic — crew", () => {
  it("detects a captain requirement", () => {
    expect(interpret("яхта с капитаном").crew?.captainRequired).toBe(true);
  });

  it("leaves the captain flag null rather than false when unmentioned", () => {
    // "not mentioned" is not the same as "explicitly not wanted" — only the former is knowable here.
    expect(interpret("яхта в Греции").crew).toBeNull();
  });

  it("reads an explicit bareboat request, overriding any captain marker", () => {
    expect(interpret("яхта без экипажа").crew?.crewType).toBe("BAREBOAT");
  });

  it("reads a crew requirement as CREWED", () => {
    expect(interpret("яхта с полным экипажем").crew?.crewType).toBe("CREWED");
  });
});

describe("interpretQueryDeterministic — length", () => {
  it("reads a length range in meters", () => {
    expect(interpret("яхта 12-14 метров").length).toEqual({ min: 12, max: 14 });
  });

  it("reads a length range with the short Cyrillic abbreviation and an en dash", () => {
    expect(interpret("яхта 12–14 м").length).toEqual({ min: 12, max: 14 });
  });

  it("treats a bare length as a ceiling, and one introduced by 'от' as a floor", () => {
    expect(interpret("яхта до 14 м").length).toEqual({ min: null, max: 14 });
    expect(interpret("яхта от 12 м").length).toEqual({ min: 12, max: null });
  });

  it("does not confuse a duration month with a length", () => {
    // Regression guard for the UNIT_STEMS collision this module's length extraction was written
    // to avoid — "3 месяца" must stay a 90-day duration, never a 3-meter length.
    expect(interpret("экспедиция на 3 месяца").length).toBeNull();
  });
});

describe("interpretQueryDeterministic — search radius", () => {
  it("reads a stated radius in kilometers", () => {
    expect(interpret("яхта в 50 км от Сплита").searchRadiusKm).toBe(50);
  });

  it("does not confuse a radius with a cabin count", () => {
    // Regression guard: "км" and "кают" (cabins) share a one-letter stem prefix, which the
    // generic number/unit matcher would conflate if radius went through it.
    const criteria = interpret("яхта в 50 км от Сплита, 3 каюты");
    expect(criteria.searchRadiusKm).toBe(50);
    expect(criteria.capacity?.cabins).toBe(3);
  });
});

describe("interpretQueryDeterministic — price unit", () => {
  it("reads a weekly rate marker attached to the price, without inventing a separate trip length", () => {
    const criteria = interpret("яхта до 3000 EUR за неделю");
    expect(criteria.price?.maxMinor).toBe(300_000);
    expect(criteria.priceUnit).toBe("WEEK");
    // The week was consumed as the *rate*, not a separately stated trip duration.
    expect(criteria.duration).toBeNull();
  });

  it("does not infer a price unit when no rate marker follows the price", () => {
    const criteria = interpret("яхта до 3000 EUR, свободна на следующей неделе");
    expect(criteria.priceUnit).toBeNull();
  });
});

describe("interpretQueryDeterministic — the Э2 worked example", () => {
  it("parses every stated criterion from a single dense query", () => {
    const criteria = interpret(
      "яхта в 50 км от Сплита, 12–14 м, до 3000 EUR за неделю, с капитаном",
    );

    expect(criteria.location?.city).toBe("Split");
    expect(criteria.searchRadiusKm).toBe(50);
    expect(criteria.length).toEqual({ min: 12, max: 14 });
    expect(criteria.price?.maxMinor).toBe(300_000);
    expect(criteria.price?.currency).toBe("EUR");
    expect(criteria.priceUnit).toBe("WEEK");
    expect(criteria.duration).toBeNull();
    expect(criteria.crew?.captainRequired).toBe(true);
    expect(criteria.crew?.crewType).toBe("SKIPPERED");
  });
});

describe("interpretQueryDeterministic — bare 'яхта' against the real two-owner vessel-type data", () => {
  // Bug found live: "яхта Турция на октябрь для 3 человек" resolved guests and month correctly but
  // dropped both the country and the vessel type. Unlike this file's shared `vocabulary` fixture
  // above (which hands MOTOR_YACHT a pre-built "Яхта" alias, sidestepping the issue), this mirrors
  // what `buildSearchVocabulary` actually derives via `withDistinctiveWordAliases`: MOTOR_YACHT and
  // SAILING_YACHT both say "яхта" in their real `vessels.types.*` label, so it takes the *shared*
  // uniqueness handling (`maxSharedOwners`) — not a hand-authored fixture — to reproduce the bug.
  const realisticVocabulary: SearchVocabulary = {
    countries: [{ value: "Turkey", aliases: ["Turkey", "Турция"] }],
    cities: [],
    marinas: [],
    cityCountries: {},
    vesselTypes: withDistinctiveWordAliases(
      [
        { value: "MOTOR_YACHT", aliases: ["Motor yacht", "Моторная яхта"] },
        { value: "SAILING_YACHT", aliases: ["Sailing yacht", "Парусная яхта"] },
        { value: "CATAMARAN", aliases: ["Catamaran", "Катамаран"] },
      ],
      4,
      2,
    ),
    features: [],
  };

  function interpretRealistic(query: string) {
    return interpretQueryDeterministic({ query, vocabulary: realisticVocabulary, locales: LOCALES });
  }

  it("resolves the country, month and guest count from the exact reported query", () => {
    const criteria = interpretRealistic("яхта Турция на октябрь для 3 человек");

    expect(criteria.location?.country).toBe("Turkey");
    expect(criteria.date?.month).toBe(10);
    expect(criteria.capacity?.persons).toBe(3);
  });

  it("maps a bare 'яхта' to every yacht sub-type instead of matching none", () => {
    const criteria = interpretRealistic("яхта Турция на октябрь для 3 человек");

    expect(criteria.vesselTypes.sort()).toEqual(["MOTOR_YACHT", "SAILING_YACHT"]);
    expect(criteria.vesselTypes).not.toContain("CATAMARAN");
  });
});

describe("interpretQueryDeterministic — every registered vessel type (Database.Enums.vessel_type)", () => {
  // Built from the *real* enum (`vesselTypeValues`), not a hand-picked subset — this test fails
  // the moment a new vessel type is added to the database without a label here, which is exactly
  // the "every registered type" guarantee this suite is for. Labels mirror messages/en.json and
  // messages/ru.json's `vessels.types.*`, and the vocabulary is built the same way
  // `buildSearchVocabulary` builds it — through `withDistinctiveWordAliases`, not hand-picked
  // aliases.
  const ALL_VESSEL_LABELS: Record<(typeof vesselTypeValues)[number], { en: string; ru: string }> = {
    MOTOR_YACHT: { en: "Motor yacht", ru: "Моторная яхта" },
    SAILING_YACHT: { en: "Sailing yacht", ru: "Парусная яхта" },
    CATAMARAN: { en: "Catamaran", ru: "Катамаран" },
    TRIMARAN: { en: "Trimaran", ru: "Тримаран" },
    SUPERYACHT: { en: "Superyacht", ru: "Суперъяхта" },
    EXPEDITION_YACHT: { en: "Expedition vessel", ru: "Экспедиционное судно" },
    RESEARCH_VESSEL: { en: "Research vessel", ru: "Исследовательское судно" },
    MOTOR_BOAT: { en: "Motor boat", ru: "Моторный катер" },
    SAILING_BOAT: { en: "Sailing boat", ru: "Парусная лодка" },
    OTHER: { en: "Other vessel", ru: "Другое судно" },
  };

  const fullVesselVocabulary: SearchVocabulary = {
    countries: [],
    cities: [],
    marinas: [],
    cityCountries: {},
    features: [],
    vesselTypes: withDistinctiveWordAliases(
      vesselTypeValues.map((value) => ({
        value,
        aliases: [value, ALL_VESSEL_LABELS[value].en, ALL_VESSEL_LABELS[value].ru],
      })),
      4,
      2,
    ),
  };

  function interpretVessel(query: string) {
    return interpretQueryDeterministic({ query, vocabulary: fullVesselVocabulary, locales: LOCALES });
  }

  // `toContain`, not `toEqual`: some registered types deliberately share a qualifier or head word
  // with a sibling (e.g. "Парусная" names both the sailing yacht and the sailing boat) — the same
  // "any yacht, not any vessel" breadth `withDistinctiveWordAliases`'s own doc comment documents
  // for "яхта" applies here too. What matters for this suite is that the type is *recognised at
  // all*, for every entry the enum actually defines.
  it.each([
    ["Motor yacht", "MOTOR_YACHT"],
    ["Моторная яхта", "MOTOR_YACHT"],
    ["Sailing yacht", "SAILING_YACHT"],
    ["Парусная яхта", "SAILING_YACHT"],
    ["Catamaran", "CATAMARAN"],
    ["Катамаран", "CATAMARAN"],
    ["Trimaran", "TRIMARAN"],
    ["Тримаран", "TRIMARAN"],
    ["Superyacht", "SUPERYACHT"],
    ["Суперъяхта", "SUPERYACHT"],
    ["Expedition vessel", "EXPEDITION_YACHT"],
    ["Экспедиционное судно", "EXPEDITION_YACHT"],
    ["Research vessel", "RESEARCH_VESSEL"],
    ["Исследовательское судно", "RESEARCH_VESSEL"],
    ["Motor boat", "MOTOR_BOAT"],
    ["Моторный катер", "MOTOR_BOAT"],
    ["Sailing boat", "SAILING_BOAT"],
    ["Парусная лодка", "SAILING_BOAT"],
    ["Other vessel", "OTHER"],
    ["Другое судно", "OTHER"],
  ] as const)("recognises %s as %s", (label, expected) => {
    expect(interpretVessel(`rent a ${label} please`).vesselTypes).toContain(expected);
  });

  // These four have no sibling sharing a qualifier or head word, so — unlike the pairs above —
  // they resolve to exactly one type, not a family.
  it.each([
    ["Catamaran", "CATAMARAN"],
    ["Trimaran", "TRIMARAN"],
    ["Expedition vessel", "EXPEDITION_YACHT"],
    ["Research vessel", "RESEARCH_VESSEL"],
  ] as const)("resolves %s to exactly %s, with no sibling drawn in", (label, expected) => {
    expect(interpretVessel(`rent a ${label} please`).vesselTypes).toEqual([expected]);
  });

  it("recognises two explicitly named types in one query without dropping either", () => {
    const criteria = interpretVessel("catamaran or trimaran, either works");
    expect(criteria.vesselTypes.sort()).toEqual(["CATAMARAN", "TRIMARAN"]);
  });
});

describe("interpretQueryDeterministic — explicit DD.MM.YYYY dates", () => {
  it("reads a single DD.MM.YYYY date as an exact start with no stated end", () => {
    const criteria = interpret("яхта на 15.09.2026");
    expect(criteria.date).toEqual({ from: "2026-09-15", to: null, month: null, year: null, flexible: null });
  });

  it("reads a dash-separated DD.MM.YYYY range", () => {
    const criteria = interpret("яхта 01.06.2026-10.06.2026");
    expect(criteria.date?.from).toBe("2026-06-01");
    expect(criteria.date?.to).toBe("2026-06-10");
    expect(criteria.date?.flexible).toBeNull();
  });

  it("reads a 'с ... по ...' DD.MM.YYYY range in Russian", () => {
    const criteria = interpret("яхта с 01.06.2026 по 10.06.2026");
    expect(criteria.date?.from).toBe("2026-06-01");
    expect(criteria.date?.to).toBe("2026-06-10");
  });

  it("reads a 'from ... to ...' DD.MM.YYYY range in English", () => {
    const criteria = interpret("yacht from 01.06.2026 to 10.06.2026");
    expect(criteria.date?.from).toBe("2026-06-01");
    expect(criteria.date?.to).toBe("2026-06-10");
  });

  it("accepts single-digit day and month", () => {
    const criteria = interpret("yacht on 5.9.2026");
    expect(criteria.date?.from).toBe("2026-09-05");
  });

  it("rejects a day that doesn't exist in the stated month, inventing no exact date", () => {
    // February 2026 has 28 days — this must not silently roll over into March. The bare "2026"
    // is still a plausible standalone year mention (same tolerance a plain typo elsewhere in a
    // query already gets), so only `from`/`to` — the fabricated part — are asserted null here.
    const criteria = interpret("яхта 30.02.2026");
    expect(criteria.date?.from).toBeNull();
    expect(criteria.date?.to).toBeNull();
  });

  it("rejects an out-of-range month, inventing no exact date", () => {
    const criteria = interpret("яхта 15.13.2026");
    expect(criteria.date?.from).toBeNull();
    expect(criteria.date?.to).toBeNull();
  });

  it("accepts a valid leap-day date", () => {
    const criteria = interpret("яхта 29.02.2028");
    expect(criteria.date?.from).toBe("2028-02-29");
  });

  it("does not confuse date digits with the guest count or price in a dense query", () => {
    const criteria = interpret(
      "яхта в Афинах с 01.06.2026 по 10.06.2026, 6 человек, бюджет до 5000 EUR",
    );
    expect(criteria.date?.from).toBe("2026-06-01");
    expect(criteria.date?.to).toBe("2026-06-10");
    expect(criteria.capacity?.persons).toBe(6);
    expect(criteria.price?.maxMinor).toBe(500_000);
    expect(criteria.location?.city).toBe("Athens");
  });
});

describe("interpretQueryDeterministic — relative week", () => {
  const TODAY = new Date(Date.UTC(2026, 7, 26)); // Wednesday, 2026-08-26

  it("resolves 'next week' to the following Monday-Sunday range", () => {
    const criteria = interpret("yacht available next week", TODAY);
    expect(criteria.date).toEqual({
      from: "2026-08-31",
      to: "2026-09-06",
      month: null,
      year: null,
      flexible: null,
    });
  });

  it("resolves 'на следующую неделю' the same way, in Russian", () => {
    const criteria = interpret("яхта на следующую неделю", TODAY);
    expect(criteria.date?.from).toBe("2026-08-31");
    expect(criteria.date?.to).toBe("2026-09-06");
  });

  it("resolves 'на следующей неделе' (locative case) the same way", () => {
    const criteria = interpret("яхта свободна на следующей неделе", TODAY);
    expect(criteria.date?.from).toBe("2026-08-31");
    expect(criteria.date?.to).toBe("2026-09-06");
  });

  it("rolls the week over into the next year across a year boundary", () => {
    const lateDecember = new Date(Date.UTC(2026, 11, 29)); // Tuesday, 2026-12-29
    const criteria = interpret("yacht next week", lateDecember);
    expect(criteria.date?.from).toBe("2027-01-04");
    expect(criteria.date?.to).toBe("2027-01-10");
  });

  it("prefers an explicit date over a 'next week' mention in the same query", () => {
    const criteria = interpret("yacht next week, actually book it for 15.09.2026", TODAY);
    expect(criteria.date?.from).toBe("2026-09-15");
    expect(criteria.date?.to).toBeNull();
  });
});

describe("interpretQueryDeterministic — relative year", () => {
  const TODAY = new Date(Date.UTC(2026, 7, 26)); // 2026-08-26

  it("resolves 'next year' to today's year plus one, with no month", () => {
    const criteria = interpret("аренда на следующий год", TODAY);
    expect(criteria.date).toEqual({ from: null, to: null, month: null, year: 2027, flexible: null });
  });

  it("resolves 'next year' in English the same way", () => {
    expect(interpret("charter next year", TODAY).date?.year).toBe(2027);
  });

  it("combines a literal month with a 'next year' phrase", () => {
    const criteria = interpret("yacht next year in September", TODAY);
    expect(criteria.date?.month).toBe(9);
    expect(criteria.date?.year).toBe(2027);
    expect(criteria.date?.flexible).toBe(true);
  });

  it("prefers an explicit 4-digit year over a 'next year' phrase in the same query", () => {
    const criteria = interpret("yacht next year, actually 2030", TODAY);
    expect(criteria.date?.year).toBe(2030);
  });
});

describe("interpretQueryDeterministic — seasons", () => {
  const TODAY = new Date(Date.UTC(2026, 7, 26)); // 2026-08-26, mid-summer

  it("resolves 'summer' to the current, still-ongoing summer", () => {
    const criteria = interpret("yacht this summer", TODAY);
    expect(criteria.date).toEqual({
      from: "2026-06-01",
      to: "2026-08-31",
      month: null,
      year: null,
      flexible: true,
    });
  });

  it("resolves 'летом' the same way, in Russian", () => {
    const criteria = interpret("яхта летом", TODAY);
    expect(criteria.date?.from).toBe("2026-06-01");
    expect(criteria.date?.to).toBe("2026-08-31");
    expect(criteria.date?.flexible).toBe(true);
  });

  it("resolves 'autumn'/'осенью' to the upcoming autumn", () => {
    expect(interpret("yacht in autumn", TODAY).date).toEqual({
      from: "2026-09-01",
      to: "2026-11-30",
      month: null,
      year: null,
      flexible: true,
    });
    expect(interpret("яхта осенью", TODAY).date?.from).toBe("2026-09-01");
  });

  it("resolves 'fall' as a synonym for 'autumn'", () => {
    expect(interpret("yacht this fall", TODAY).date?.to).toBe("2026-11-30");
  });

  it("resolves 'winter'/'зимой' across the year boundary", () => {
    expect(interpret("yacht in winter", TODAY).date).toEqual({
      from: "2026-12-01",
      to: "2027-02-28",
      month: null,
      year: null,
      flexible: true,
    });
    expect(interpret("яхта зимой", TODAY).date?.to).toBe("2027-02-28");
  });

  it("rolls 'spring'/'весной' forward a year once this year's spring has already passed", () => {
    // Today (August) is well past this year's spring, so it must resolve to next year's.
    expect(interpret("yacht in spring", TODAY).date).toEqual({
      from: "2027-03-01",
      to: "2027-05-31",
      month: null,
      year: null,
      flexible: true,
    });
    expect(interpret("яхта весной", TODAY).date?.from).toBe("2027-03-01");
  });

  it("prefers a literal month name over a season mentioned in the same query", () => {
    const criteria = interpret("yacht in spring, actually in December", TODAY);
    expect(criteria.date?.month).toBe(12);
    expect(criteria.date?.from).toBeNull();
  });

  it("prefers an explicit date over a season mentioned in the same query", () => {
    const criteria = interpret("yacht in summer, book it for 15.09.2026", TODAY);
    expect(criteria.date?.from).toBe("2026-09-15");
  });
});

describe("interpretQueryDeterministic — city implies country", () => {
  it("derives the country from a recognised city when no country is stated", () => {
    expect(interpret("яхта в Афинах").location?.country).toBe("Greece");
    expect(interpret("yacht in Split").location?.country).toBe("Croatia");
  });

  it("keeps a stated country even when it contradicts the mentioned city's own country", () => {
    // Contrived on purpose: the query says both "Norway" and "Athens" — the explicitly stated
    // country must win, never be silently overridden by the city-derived one.
    const criteria = interpret("yacht in Norway, near Athens marina style");
    expect(criteria.location?.country).toBe("Norway");
    expect(criteria.location?.city).toBe("Athens");
  });

  it("leaves the country null for a city with no known country mapping", () => {
    const vocabularyWithoutMapping: SearchVocabulary = { ...vocabulary, cityCountries: {} };
    const criteria = interpretQueryDeterministic({
      query: "яхта в Афинах",
      vocabulary: vocabularyWithoutMapping,
      locales: LOCALES,
    });
    expect(criteria.location?.city).toBe("Athens");
    expect(criteria.location?.country).toBeNull();
  });

  it("still resolves the country when only a country is stated and no city is mentioned", () => {
    expect(interpret("яхта в Норвегии").location?.country).toBe("Norway");
    expect(interpret("яхта в Норвегии").location?.city).toBeNull();
  });
});

describe("interpretQueryDeterministic — combined smart-search scenarios", () => {
  const TODAY = new Date(Date.UTC(2026, 7, 26)); // 2026-08-26

  it.each([
    {
      name: "city-derived country + exact DD.MM.YYYY range + guests + symbol price",
      query: "яхта в Афинах с 01.07.2026 по 08.07.2026 на 6 человек, до €4500",
      expect: (criteria: ReturnType<typeof interpret>) => {
        expect(criteria.location).toMatchObject({ city: "Athens", country: "Greece" });
        expect(criteria.date).toMatchObject({ from: "2026-07-01", to: "2026-07-08" });
        expect(criteria.capacity?.persons).toBe(6);
        expect(criteria.price).toMatchObject({ maxMinor: 450_000, currency: "EUR" });
      },
    },
    {
      name: "explicit country overrides city country + catamaran + next week + ISO currency",
      query: "катамаран в Хорватии рядом со Сплитом на следующую неделю, бюджет до 3000 EUR",
      expect: (criteria: ReturnType<typeof interpret>) => {
        expect(criteria.location).toMatchObject({ country: "Croatia", city: "Split" });
        expect(criteria.vesselTypes).toEqual(["CATAMARAN"]);
        expect(criteria.date).toMatchObject({ from: "2026-08-31", to: "2026-09-06" });
        expect(criteria.price?.maxMinor).toBe(300_000);
      },
    },
    {
      name: "expedition yacht + season + minimum price marker + captain",
      query: "экспедиция в Норвегии летом, от 8000 EUR, с капитаном",
      expect: (criteria: ReturnType<typeof interpret>) => {
        expect(criteria.vesselTypes).toEqual(["EXPEDITION_YACHT"]);
        expect(criteria.location?.country).toBe("Norway");
        expect(criteria.date).toMatchObject({ from: "2026-06-01", to: "2026-08-31", flexible: true });
        expect(criteria.price).toMatchObject({ minMinor: 800_000, maxMinor: null });
        expect(criteria.crew?.captainRequired).toBe(true);
      },
    },
    {
      name: "research vessel + next year + literal month + spelled-out guest count",
      query: "research vessel next year in October for six people",
      expect: (criteria: ReturnType<typeof interpret>) => {
        expect(criteria.vesselTypes).toEqual(["RESEARCH_VESSEL"]);
        expect(criteria.date).toMatchObject({ month: 10, year: 2027 });
        expect(criteria.capacity?.persons).toBe(6);
      },
    },
    {
      name: "bareboat catamaran + winter season + weekly rate wording ignored as duration",
      query: "катамаран без экипажа зимой, до 3000 EUR за неделю",
      expect: (criteria: ReturnType<typeof interpret>) => {
        expect(criteria.vesselTypes).toEqual(["CATAMARAN"]);
        expect(criteria.crew?.crewType).toBe("BAREBOAT");
        expect(criteria.date).toMatchObject({ from: "2026-12-01", to: "2027-02-28" });
        expect(criteria.priceUnit).toBe("WEEK");
        expect(criteria.price?.maxMinor).toBe(300_000);
      },
    },
  ])("$name", ({ query, expect: assertions }) => {
    assertions(interpret(query, TODAY));
  });
});
