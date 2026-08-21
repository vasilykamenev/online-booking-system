import { describe, expect, it } from "vitest";
import { vesselImageFinalPath, vesselImageRawPath } from "./vessel-image-path";

const VESSEL_ID = "11111111-1111-1111-1111-111111111111";

describe("vesselImageRawPath", () => {
  it("puts the file under {vesselId}/raw/ — the folder the storage RLS policy checks", () => {
    const path = vesselImageRawPath(VESSEL_ID, "Adriatic Dream", "jpg");
    expect(path.startsWith(`${VESSEL_ID}/raw/`)).toBe(true);
    expect(path.endsWith(".jpg")).toBe(true);
  });

  it("includes a readable, ASCII-only slug of the vessel name", () => {
    const path = vesselImageRawPath(VESSEL_ID, "Adriatic Dream", "jpg");
    expect(path).toContain("adriatic-dream");
  });

  it("produces a different filename for two calls with the same inputs (no accidental overwrite)", () => {
    const first = vesselImageRawPath(VESSEL_ID, "Adriatic Dream", "jpg");
    const second = vesselImageRawPath(VESSEL_ID, "Adriatic Dream", "jpg");
    expect(first).not.toBe(second);
  });

  it("strips accents and non-ASCII characters from the name so the path stays URL-safe", () => {
    const path = vesselImageRawPath(VESSEL_ID, "Café Königin", "jpg");
    expect(path).toMatch(/cafe-konigin/);
    expect(/^[\x00-\x7F]*$/.test(path)).toBe(true);
  });

  it("falls back to a generic slug for a name with no usable ASCII characters", () => {
    const path = vesselImageRawPath(VESSEL_ID, "★彩虹★", "jpg");
    expect(path).toContain(`${VESSEL_ID}/raw/vessel-`);
  });
});

describe("vesselImageFinalPath", () => {
  it("puts the file directly under {vesselId}/ (no raw/ prefix) and always uses .webp", () => {
    const path = vesselImageFinalPath(VESSEL_ID, "Adriatic Dream");
    expect(path.startsWith(`${VESSEL_ID}/`)).toBe(true);
    expect(path).not.toContain("/raw/");
    expect(path.endsWith(".webp")).toBe(true);
  });

  it("two different vessels sharing a display name never collide, since the folder is the vessel id", () => {
    const otherVesselId = "22222222-2222-2222-2222-222222222222";
    const first = vesselImageFinalPath(VESSEL_ID, "Sea Breeze");
    const second = vesselImageFinalPath(otherVesselId, "Sea Breeze");
    expect(first).not.toBe(second);
    expect(first.startsWith(`${VESSEL_ID}/`)).toBe(true);
    expect(second.startsWith(`${otherVesselId}/`)).toBe(true);
  });
});
