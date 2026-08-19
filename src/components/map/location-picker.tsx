"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

const PIN_ICON_HTML = `
  <div style="transform: translate(-50%, -100%)">
    <svg width="30" height="38" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.716 23.284 0 15 0z" fill="var(--primary)"/>
      <circle cx="15" cy="15" r="5.5" fill="var(--primary-foreground)"/>
    </svg>
  </div>
`;

const WORLD_CENTER: [number, number] = [20, 0];
const WORLD_ZOOM = 2;
const PIN_ZOOM = 13;

/**
 * Click-to-drop map picker. When `latName`/`lngName` are given, it renders hidden
 * inputs under those names so it plugs directly into the existing native
 * `<form action={serverAction}>` pattern used across the app. When the caller
 * already owns visible lat/lng fields (e.g. admin's manually-editable inputs),
 * omit `latName`/`lngName` and pass `onChange` instead — a click reports the picked
 * point back so the caller can write it into its own fields.
 * Until the user clicks, it follows `fallbackLatitude`/`fallbackLongitude` (e.g. the
 * selected marina's stored point) so switching a dropdown re-centers the map —
 * `onChange` does NOT fire for this case, since the fallback's source already
 * knows its own coordinates (no need to report them back to itself).
 */
export function LocationPicker({
  latName,
  lngName,
  initialLatitude,
  initialLongitude,
  fallbackLatitude,
  fallbackLongitude,
  hint,
  onChange,
}: {
  latName?: string;
  lngName?: string;
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  fallbackLatitude?: number | null;
  fallbackLongitude?: number | null;
  hint?: string;
  onChange?: (latitude: number, longitude: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const hasManualPinRef = useRef(initialLatitude != null && initialLongitude != null);
  // The map-click handler below is registered once (mount-only effect); keep the
  // latest onChange in a ref so it doesn't call a stale closure of the prop.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const [manualPosition, setManualPosition] = useState<[number, number] | null>(
    initialLatitude != null && initialLongitude != null ? [initialLatitude, initialLongitude] : null,
  );
  // Derived, not mirrored via effect: renders the fallback immediately (no extra
  // render pass) until the user drops their own pin.
  const position: [number, number] | null =
    manualPosition ??
    (fallbackLatitude != null && fallbackLongitude != null
      ? [fallbackLatitude, fallbackLongitude]
      : null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      const leaflet = await import("leaflet");
      const L = leaflet.default ?? leaflet;
      if (cancelled || !containerRef.current) return;

      const icon = L.divIcon({
        html: PIN_ICON_HTML,
        className: "",
        iconSize: [30, 38],
        iconAnchor: [15, 38],
      });

      const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
        position ?? WORLD_CENTER,
        position ? PIN_ZOOM : WORLD_ZOOM,
      );
      mapRef.current = map;
      map.attributionControl.setPrefix(false);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      if (position) {
        markerRef.current = L.marker(position, { icon }).addTo(map);
      }

      map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
        hasManualPinRef.current = true;
        const next: [number, number] = [event.latlng.lat, event.latlng.lng];
        setManualPosition(next);
        onChangeRef.current?.(next[0], next[1]);
        if (markerRef.current) {
          markerRef.current.setLatLng(next);
        } else {
          markerRef.current = L.marker(next, { icon }).addTo(map);
        }
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Map is created once; subsequent position changes are applied imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center the Leaflet instance on the fallback (e.g. selected marina) until the
  // user places their own pin. `position` above already derives the displayed/
  // submitted value from props/state — this effect only drives the imperative
  // map API, an external system React doesn't manage. Deliberately does NOT call
  // onChange: the fallback source (e.g. a location picked from a dropdown) already
  // knows its own point, so the caller should read it directly rather than pay for
  // a reverse-geocode round trip onChange is meant for actual clicks.
  useEffect(() => {
    if (hasManualPinRef.current) return;
    if (fallbackLatitude == null || fallbackLongitude == null) return;
    const next: [number, number] = [fallbackLatitude, fallbackLongitude];

    const map = mapRef.current;
    if (!map) return;
    map.setView(next, PIN_ZOOM);

    (async () => {
      const leaflet = await import("leaflet");
      const L = leaflet.default ?? leaflet;
      const icon = L.divIcon({
        html: PIN_ICON_HTML,
        className: "",
        iconSize: [30, 38],
        iconAnchor: [15, 38],
      });
      if (markerRef.current) {
        markerRef.current.setLatLng(next);
      } else {
        markerRef.current = L.marker(next, { icon }).addTo(map);
      }
    })();
  }, [fallbackLatitude, fallbackLongitude]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-2xl border border-border"
      />
      {hint && <p className="text-xs font-light text-muted-foreground">{hint}</p>}
      {position && (
        <p className="text-xs font-light text-muted-foreground">
          {position[0].toFixed(5)}, {position[1].toFixed(5)}
        </p>
      )}
      {latName && <input type="hidden" name={latName} value={position ? position[0] : ""} readOnly />}
      {lngName && <input type="hidden" name={lngName} value={position ? position[1] : ""} readOnly />}
    </div>
  );
}
