import { describe, expect, it } from "vitest";
import { collectCityCountries, collectEntries, withDistinctiveWordAliases } from "./vocabulary";

const LOCALES = ["en", "ru"] as const;

describe("collectEntries", () => {
  it("uses the first preferred locale as the canonical value and keeps the rest as aliases", () => {
    const [entry] = collectEntries([{ en: "Croatia", ru: "Хорватия" }], LOCALES);
    expect(entry.value).toBe("Croatia");
    expect(entry.aliases).toEqual(expect.arrayContaining(["Croatia", "Хорватия"]));
  });

  it("merges duplicate rows so one country appears once however many marinas it has", () => {
    const entries = collectEntries(
      [
        { en: "Croatia", ru: "Хорватия" },
        { en: "Croatia", ru: "Хорватия" },
        { en: "Greece", ru: "Греция" },
      ],
      LOCALES,
    );
    expect(entries).toHaveLength(2);
  });

  it("skips null and empty reference values", () => {
    expect(collectEntries([null, undefined, {}, { en: "   " }], LOCALES)).toEqual([]);
  });

  it("falls back to another locale's label when the preferred one is missing", () => {
    const [entry] = collectEntries([{ ru: "Норвегия" }], LOCALES);
    expect(entry.value).toBe("Норвегия");
  });

  it("keeps labels from locales outside the preferred order as aliases", () => {
    const [entry] = collectEntries([{ en: "Greece", ru: "Греция", de: "Griechenland" }], LOCALES);
    expect(entry.value).toBe("Greece");
    expect(entry.aliases).toContain("Griechenland");
  });

  it("keeps a per-locale label so a chip can be shown in the reader's language", () => {
    // The canonical value stays English for stable matching, but a Russian reader must see
    // "Греция" on the criteria chip — not the canonical "Greece".
    const [entry] = collectEntries([{ en: "Greece", ru: "Греция" }], LOCALES);
    expect(entry.value).toBe("Greece");
    expect(entry.labels?.ru).toBe("Греция");
    expect(entry.labels?.en).toBe("Greece");
  });

  it("merges per-locale labels across duplicate rows", () => {
    const [entry] = collectEntries(
      [{ en: "Croatia" }, { en: "Croatia", ru: "Хорватия" }],
      LOCALES,
    );
    expect(entry.labels?.ru).toBe("Хорватия");
  });
});

describe("withDistinctiveWordAliases", () => {
  // Mirrors the real `vessels.types.*` labels, where every Russian label but one ends in "судно".
  const vesselTypes = [
    { value: "MOTOR_YACHT", aliases: ["Yacht", "Моторная яхта"] },
    { value: "EXPEDITION_YACHT", aliases: ["Expedition vessel", "Экспедиционное судно"] },
    { value: "RESEARCH_VESSEL", aliases: ["Research vessel", "Исследовательское судно"] },
    { value: "OTHER", aliases: ["Other vessel", "Другое судно"] },
  ];

  it("adds a word that belongs to exactly one entry", () => {
    const [, expedition] = withDistinctiveWordAliases(vesselTypes);
    expect(expedition.aliases).toContain("экспедиционное");
  });

  it("drops words shared by several entries, with no stopword list", () => {
    // "судно" and "vessel" each appear in three labels, so they are generic by construction.
    for (const entry of withDistinctiveWordAliases(vesselTypes)) {
      expect(entry.aliases).not.toContain("судно");
      expect(entry.aliases).not.toContain("vessel");
    }
  });

  it("adds a short but distinctive word like 'яхта'", () => {
    const [yacht] = withDistinctiveWordAliases(vesselTypes);
    expect(yacht.aliases).toContain("яхта");
  });

  it("leaves single-word labels untouched", () => {
    const [entry] = withDistinctiveWordAliases([{ value: "wifi", aliases: ["Wi-Fi"] }]);
    expect(entry.aliases).toEqual(["Wi-Fi"]);
  });

  it("never drops an original alias", () => {
    for (const entry of withDistinctiveWordAliases(vesselTypes)) {
      const original = vesselTypes.find((candidate) => candidate.value === entry.value)!;
      expect(entry.aliases).toEqual(expect.arrayContaining(original.aliases));
    }
  });

  // Reproduces the real `vessels.types.*` data — unlike the fixture above, both a motor and a
  // sailing yacht say "яхта"/"yacht", which is exactly the case a flat uniqueness check gets wrong
  // (bug found live: a bare "яхта" query matched no vessel type at all, silently searching every
  // type instead of narrowing to yachts).
  const yachtFamily = [
    { value: "MOTOR_YACHT", aliases: ["Yacht", "Моторная яхта"] },
    { value: "SAILING_YACHT", aliases: ["Yacht", "Парусная яхта"] },
    { value: "CATAMARAN", aliases: ["Catamaran", "Катамаран"] },
  ];

  it("adds a word shared by up to maxSharedOwners entries to every one of them", () => {
    const [motor, sailing, catamaran] = withDistinctiveWordAliases(yachtFamily, 4, 2);
    expect(motor.aliases).toContain("яхта");
    expect(sailing.aliases).toContain("яхта");
    expect(catamaran.aliases).not.toContain("яхта");
  });

  it("still drops a word shared by more entries than maxSharedOwners allows", () => {
    // "судно"/"vessel" span three unrelated types here, same as the default-threshold test above —
    // raising the threshold to 2 must not suddenly treat a three-way word as a shared category.
    for (const entry of withDistinctiveWordAliases(vesselTypes, 4, 2)) {
      expect(entry.aliases).not.toContain("судно");
      expect(entry.aliases).not.toContain("vessel");
    }
  });

  it("defaults to the strict single-owner rule when maxSharedOwners is omitted", () => {
    const [motor, sailing] = withDistinctiveWordAliases(yachtFamily);
    expect(motor.aliases).not.toContain("яхта");
    expect(sailing.aliases).not.toContain("яхта");
  });
});

describe("collectCityCountries", () => {
  it("maps a city to the country from the same row", () => {
    const map = collectCityCountries(
      [{ country: { en: "Croatia", ru: "Хорватия" }, city: { en: "Split", ru: "Сплит" } }],
      ["en", "ru"],
    );
    expect(map).toEqual({ Split: "Croatia" });
  });

  it("merges several rows into one map, keyed by canonical city", () => {
    const map = collectCityCountries(
      [
        { country: { en: "Croatia" }, city: { en: "Split" } },
        { country: { en: "Greece" }, city: { en: "Athens" } },
        { country: { en: "Croatia" }, city: { en: "Split" } },
      ],
      ["en", "ru"],
    );
    expect(map).toEqual({ Split: "Croatia", Athens: "Greece" });
  });

  it("skips rows missing a country or a city", () => {
    const map = collectCityCountries(
      [
        { country: null, city: { en: "Athens" } },
        { country: { en: "Greece" }, city: null },
        { country: undefined, city: undefined },
      ],
      ["en", "ru"],
    );
    expect(map).toEqual({});
  });

  it("keeps the first country a city was seeded under when rows disagree", () => {
    const map = collectCityCountries(
      [
        { country: { en: "Country A" }, city: { en: "Ambiguous City" } },
        { country: { en: "Country B" }, city: { en: "Ambiguous City" } },
      ],
      ["en", "ru"],
    );
    expect(map).toEqual({ "Ambiguous City": "Country A" });
  });

  it("falls back to another locale's label when the preferred one is missing, on both sides", () => {
    const map = collectCityCountries([{ country: { ru: "Норвегия" }, city: { ru: "Тромсё" } }], ["en", "ru"]);
    expect(map).toEqual({ "Тромсё": "Норвегия" });
  });
});
