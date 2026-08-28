/**
 * Geo helpers for `searchRadiusKm` (Арх §5, §9). Bounding box + haversine rather than PostGIS
 * (docs/AI_Federated_Search_Migration_Plan_v1.md §8 п.4): one dependency fewer, and the precision
 * a radius filter actually needs — "within roughly N km" — doesn't justify a spatial extension.
 */

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, in kilometers. */
export function haversineDistanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/**
 * A cheap pre-filter box around a center point. Meant to run before `haversineDistanceKm` narrows
 * the box's corners down to an actual circle — e.g. a DB query filters by this box's four columns
 * (cheap, indexable), then the exact radius check runs in application code on the much smaller
 * surviving set.
 *
 * Longitude degrees shrink toward the poles (`cos(latitude)`), which is why the longitude span
 * widens at high latitudes; latitude degrees don't have this effect. Clamped to the valid ranges so
 * a radius large enough to wrap past a pole or the antimeridian still returns a usable (if
 * maximally wide) box rather than an out-of-range value.
 */
export function boundingBox(center: { latitude: number; longitude: number }, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / EARTH_RADIUS_KM;
  const lngDelta = radiusKm / (EARTH_RADIUS_KM * Math.cos(toRadians(center.latitude)) || 1);

  return {
    minLatitude: Math.max(-90, center.latitude - (latDelta * 180) / Math.PI),
    maxLatitude: Math.min(90, center.latitude + (latDelta * 180) / Math.PI),
    minLongitude: Math.max(-180, center.longitude - (lngDelta * 180) / Math.PI),
    maxLongitude: Math.min(180, center.longitude + (lngDelta * 180) / Math.PI),
  };
}

/** True when `point` is within `radiusKm` of `center` — the exact check the bounding box prefilters for. */
export function isWithinRadiusKm(
  center: { latitude: number; longitude: number },
  point: { latitude: number; longitude: number },
  radiusKm: number,
): boolean {
  return haversineDistanceKm(center, point) <= radiusKm;
}
