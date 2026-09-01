import { describe, expect, it } from "vitest";
import { pickBestLocationMatch } from "@/server/search/index/location-resolver";

const split = {
  country: { ru: "Хорватия", en: "Croatia" },
  city: { ru: "Сплит", en: "Split" },
  marina: { ru: "ACI Марина Сплит", en: "ACI Marina Split" },
  latitude: 43.50848,
  longitude: 16.43965,
};

const ikaria = {
  country: { ru: "Греция", en: "Greece" },
  city: { ru: "Икария", en: "Ikaria" },
  marina: null,
  latitude: 37.5928,
  longitude: 26.2836,
};

describe("pickBestLocationMatch", () => {
  it("returns null for an empty trail", () => {
    expect(pickBestLocationMatch([], [split])).toBeNull();
  });

  it("returns null when nothing in the trail matches any known place", () => {
    expect(pickBestLocationMatch(["Home", "All yachts", "Turkey"], [split, ikaria])).toBeNull();
  });

  it("prefers a marina match over a city/country-only match", () => {
    const result = pickBestLocationMatch(["Home", "Croatia", "Split", "ACI Marina Split"], [split, ikaria]);
    expect(result).toEqual({
      country: "Croatia",
      city: "Split",
      marina: "ACI Marina Split",
      latitude: 43.50848,
      longitude: 16.43965,
    });
  });

  it("matches case- and diacritic-insensitively, same as the rest of the pipeline", () => {
    const result = pickBestLocationMatch(["split"], [split]);
    expect(result?.city).toBe("Split");
  });

  it("falls back to a city match when no marina crumb is present", () => {
    const result = pickBestLocationMatch(["Home", "Greece", "Ikaria"], [split, ikaria]);
    expect(result).toEqual({ country: "Greece", city: "Ikaria", marina: null, latitude: 37.5928, longitude: 26.2836 });
  });

  it("matches on the Russian crumb but stores the row's English label, per the index's English-only policy", () => {
    const result = pickBestLocationMatch(["Икария"], [ikaria]);
    expect(result?.city).toBe("Ikaria");
    // Country wasn't in the trail at all — borrows the row's own `en` label rather than leaving it
    // null, since the row itself is already the confirmed match via city.
    expect(result?.country).toBe("Greece");
  });

  it("falls back to whatever label a row has when it carries no `en` entry yet", () => {
    const noEnglishYet = {
      country: { ru: "Черногория" },
      city: { ru: "Котор" },
      marina: null,
      latitude: 42.42,
      longitude: 18.77,
    };
    const result = pickBestLocationMatch(["Котор"], [noEnglishYet]);
    expect(result?.city).toBe("Котор");
    expect(result?.country).toBe("Черногория");
  });

  it("falls back to country-only with no city/marina/coordinates when only the country crumb matches", () => {
    const result = pickBestLocationMatch(["Home", "All yachts", "Croatia"], [split, ikaria]);
    expect(result).toEqual({ country: "Croatia", city: null, marina: null, latitude: null, longitude: null });
  });

  it("never borrows a city/marina from an unrelated row sharing the same country", () => {
    const anotherCroatianMarina = {
      country: { ru: "Хорватия", en: "Croatia" },
      city: { ru: "Дубровник", en: "Dubrovnik" },
      marina: { ru: "Марина Дубровник", en: "Dubrovnik Marina" },
      latitude: 42.65,
      longitude: 18.09,
    };
    const result = pickBestLocationMatch(["Croatia"], [split, anotherCroatianMarina]);
    expect(result).toEqual({ country: "Croatia", city: null, marina: null, latitude: null, longitude: null });
  });
});
