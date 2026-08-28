import { describe, expect, it, vi } from "vitest";
import {
  buildFieldErrors,
  vesselDbError,
  isNetworkActionError,
  handleUnexpectedActionError,
} from "./vessel-errors";

/** Builds a FormData the way the vessel registration form submits it. */
function vesselFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const defaults: Record<string, string> = {
    name: "Adriatic Dream",
    slug: "adriatic-dream",
    type: "MOTOR_YACHT",
    locationId: "loc-1",
    lengthMeters: "12.5",
    cabins: "3",
    guestsCapacity: "6",
    basePrice: "450",
    currency: "EUR",
    status: "draft",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    formData.set(key, value);
  }
  return formData;
}

describe("buildFieldErrors", () => {
  it("maps a missing required field to the 'required' code", () => {
    const formData = vesselFormData({ name: "" });
    const fieldErrors = buildFieldErrors(formData, {
      issues: [{ path: ["name"], message: "Too small" }],
    });
    expect(fieldErrors).toEqual({ name: "required" });
  });

  it("maps a filled-in but invalid field to the 'fieldInvalid' code", () => {
    // lengthMeters was submitted (non-empty) but fails the schema's positive/max check.
    const formData = vesselFormData({ lengthMeters: "-5" });
    const fieldErrors = buildFieldErrors(formData, {
      issues: [{ path: ["lengthMeters"], message: "Too small" }],
    });
    expect(fieldErrors).toEqual({ lengthMeters: "fieldInvalid" });
  });

  it("passes through the schema's own custom error codes unchanged", () => {
    const formData = vesselFormData({ slug: "Not A Slug!" });
    const fieldErrors = buildFieldErrors(formData, {
      issues: [{ path: ["slug"], message: "invalidSlug" }],
    });
    expect(fieldErrors).toEqual({ slug: "invalidSlug" });

    const locationFormData = vesselFormData({ locationId: "" });
    const locationErrors = buildFieldErrors(locationFormData, {
      issues: [{ path: ["locationId"], message: "invalid" }],
    });
    expect(locationErrors).toEqual({ locationId: "invalid" });
  });

  it("reports one error per field, keeping the first issue when a field fails twice", () => {
    const formData = vesselFormData({ name: "" });
    const fieldErrors = buildFieldErrors(formData, {
      issues: [
        { path: ["name"], message: "Too small" },
        { path: ["name"], message: "Some other issue" },
        { path: ["cabins"], message: "Too small" },
      ],
    });
    expect(Object.keys(fieldErrors)).toEqual(["name", "cabins"]);
    expect(fieldErrors.name).toBe("required");
  });

  it("ignores issues without a usable field path", () => {
    const formData = vesselFormData();
    const fieldErrors = buildFieldErrors(formData, { issues: [{ path: [], message: "invalid" }] });
    expect(fieldErrors).toEqual({});
  });
});

describe("vesselDbError", () => {
  it("flags a duplicate slug on the slug field", () => {
    expect(vesselDbError({ code: "23505" })).toEqual({
      error: "slugTaken",
      fieldErrors: { slug: "slugTaken" },
    });
  });

  it("flags a broken location reference on the location field", () => {
    expect(vesselDbError({ code: "23503" })).toEqual({
      error: "generic",
      fieldErrors: { locationId: "fieldInvalid" },
    });
  });

  it("falls back to a plain generic error for anything else", () => {
    expect(vesselDbError({ code: "23514" })).toEqual({ error: "generic" });
    expect(vesselDbError({})).toEqual({ error: "generic" });
  });
});

describe("isNetworkActionError", () => {
  it("recognizes a fetch-level TypeError as a network error", () => {
    expect(isNetworkActionError(new TypeError("fetch failed"))).toBe(true);
    expect(isNetworkActionError(new TypeError("ECONNREFUSED"))).toBe(true);
  });

  it("does not treat an unrelated TypeError as a network error", () => {
    expect(isNetworkActionError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("does not treat a non-TypeError as a network error", () => {
    expect(isNetworkActionError(new Error("fetch failed"))).toBe(false);
    expect(isNetworkActionError("fetch failed")).toBe(false);
    expect(isNetworkActionError(null)).toBe(false);
  });
});

describe("handleUnexpectedActionError", () => {
  it("never throws — this is the last line of defense before the route's error boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => handleUnexpectedActionError("createVessel", new Error("boom"))).not.toThrow();
    vi.restoreAllMocks();
  });

  it("returns a networkError state for connectivity failures (e.g. a geocoding request that never completed)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const state = handleUnexpectedActionError("createVessel", new TypeError("fetch failed"));
    expect(state).toEqual({ error: "networkError" });
    vi.restoreAllMocks();
  });

  it("returns a generic state for anything that isn't a connectivity failure", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const state = handleUnexpectedActionError("createVessel", new Error("unexpected"));
    expect(state).toEqual({ error: "generic" });
    vi.restoreAllMocks();
  });

  it("logs the real cause so it's visible in server logs even though the UI message stays generic", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("connection terminated unexpectedly");
    handleUnexpectedActionError("createVessel", cause);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("createVessel"), cause);
    vi.restoreAllMocks();
  });
});
