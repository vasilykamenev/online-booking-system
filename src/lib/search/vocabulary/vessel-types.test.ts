import { describe, expect, it } from "vitest";
import { normalizeVesselType, type VesselTypeAlias } from "./vessel-types";

// Shape of the seed rows in vessel_type_aliases (source_id null = global), trimmed to what these
// tests exercise.
const ALIASES: VesselTypeAlias[] = [
  { alias: "моторные яхты", vesselType: "MOTOR_YACHT" },
  { alias: "motor yacht", vesselType: "MOTOR_YACHT" },
  { alias: "gulet", vesselType: "MOTOR_YACHT" },
  { alias: "sailing yacht", vesselType: "SAILING_YACHT" },
  { alias: "sailboat", vesselType: "SAILING_YACHT" },
  { alias: "catamaran", vesselType: "CATAMARAN" },
  { alias: "research vessel", vesselType: "RESEARCH_VESSEL" },
];

describe("normalizeVesselType", () => {
  it("maps a raw type observed on brilions.com onto the canonical enum", () => {
    expect(normalizeVesselType("Моторные яхты", ALIASES)).toBe("MOTOR_YACHT");
  });

  it("is case- and accent-insensitive", () => {
    expect(normalizeVesselType("SAILING YACHT", ALIASES)).toBe("SAILING_YACHT");
    expect(normalizeVesselType("  Catamaran  ", ALIASES)).toBe("CATAMARAN");
  });

  it("maps a raw type in the shape a generic STRUCTURED_DATA source (e.g. globesailor.ru) would emit", () => {
    expect(normalizeVesselType("Sailboat", ALIASES)).toBe("SAILING_YACHT");
    expect(normalizeVesselType("Research vessel", ALIASES)).toBe("RESEARCH_VESSEL");
  });

  it("returns null for unrecognized text rather than guessing", () => {
    expect(normalizeVesselType("Спортивный катер", ALIASES)).toBeNull();
  });

  it("does not substring-match — a fishing charter must not resolve as a yacht", () => {
    // The exact failure `match-criteria.ts` was added to guard against (README, brilions live
    // test): "ЯХТА ДЛЯ РЫБАЛКИ" contains "яхта" but is not one of our vessel types.
    expect(normalizeVesselType("Яхта для рыбалки", ALIASES)).toBeNull();
  });

  it("returns null for missing input", () => {
    expect(normalizeVesselType(null, ALIASES)).toBeNull();
    expect(normalizeVesselType("", ALIASES)).toBeNull();
  });

  it("never defaults to OTHER — OTHER only comes from an explicit alias entry", () => {
    expect(normalizeVesselType("something entirely unrecognized", ALIASES)).toBeNull();
    const withOther = [...ALIASES, { alias: "houseboat", vesselType: "OTHER" as const }];
    expect(normalizeVesselType("Houseboat", withOther)).toBe("OTHER");
  });
});
