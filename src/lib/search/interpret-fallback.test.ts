import { describe, expect, it } from "vitest";
import { interpretQueryDeterministic } from "./interpret-fallback";
import type { SearchVocabulary } from "./vocabulary";

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
