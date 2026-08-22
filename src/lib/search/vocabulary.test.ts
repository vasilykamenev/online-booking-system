import { describe, expect, it } from "vitest";
import { collectEntries, withDistinctiveWordAliases } from "./vocabulary";

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
    { value: "yacht", aliases: ["Yacht", "Моторная яхта"] },
    { value: "expedition", aliases: ["Expedition vessel", "Экспедиционное судно"] },
    { value: "research", aliases: ["Research vessel", "Исследовательское судно"] },
    { value: "hybrid", aliases: ["Hybrid vessel", "Гибридное судно"] },
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
});
