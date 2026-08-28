import { describe, expect, it } from "vitest";
import { boundingBox, haversineDistanceKm, isWithinRadiusKm } from "@/lib/search/geo";

describe("haversineDistanceKm", () => {
  it("is zero for the same point", () => {
    const point = { latitude: 43.5081, longitude: 16.4402 }; // Split
    expect(haversineDistanceKm(point, point)).toBeCloseTo(0, 6);
  });

  it("matches the known great-circle distance between Split and Dubrovnik (~165km)", () => {
    const split = { latitude: 43.5081, longitude: 16.4402 };
    const dubrovnik = { latitude: 42.6507, longitude: 18.0944 };
    const distance = haversineDistanceKm(split, dubrovnik);
    expect(distance).toBeGreaterThan(150);
    expect(distance).toBeLessThan(180);
  });

  it("is symmetric", () => {
    const a = { latitude: 43.5081, longitude: 16.4402 };
    const b = { latitude: 42.6507, longitude: 18.0944 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 9);
  });
});

describe("boundingBox", () => {
  it("centers on the given point", () => {
    const center = { latitude: 43.5081, longitude: 16.4402 };
    const box = boundingBox(center, 50);
    expect(box.minLatitude).toBeLessThan(center.latitude);
    expect(box.maxLatitude).toBeGreaterThan(center.latitude);
    expect(box.minLongitude).toBeLessThan(center.longitude);
    expect(box.maxLongitude).toBeGreaterThan(center.longitude);
  });

  it("widens the longitude span at higher latitudes for the same radius", () => {
    const equator = boundingBox({ latitude: 0, longitude: 0 }, 100);
    const highLat = boundingBox({ latitude: 70, longitude: 0 }, 100);
    const equatorLngSpan = equator.maxLongitude - equator.minLongitude;
    const highLatLngSpan = highLat.maxLongitude - highLat.minLongitude;
    expect(highLatLngSpan).toBeGreaterThan(equatorLngSpan);
  });

  it("clamps to valid latitude/longitude ranges near the poles", () => {
    const box = boundingBox({ latitude: 89, longitude: 179 }, 500);
    expect(box.maxLatitude).toBeLessThanOrEqual(90);
    expect(box.maxLongitude).toBeLessThanOrEqual(180);
    expect(box.minLongitude).toBeGreaterThanOrEqual(-180);
  });
});

describe("isWithinRadiusKm", () => {
  it("accepts a point inside the radius and rejects one outside it", () => {
    const split = { latitude: 43.5081, longitude: 16.4402 };
    const dubrovnik = { latitude: 42.6507, longitude: 18.0944 };
    expect(isWithinRadiusKm(split, dubrovnik, 250)).toBe(true);
    expect(isWithinRadiusKm(split, dubrovnik, 50)).toBe(false);
  });
});
