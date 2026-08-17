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
 * Click-to-drop map picker. Renders hidden `latName`/`lngName` inputs so it plugs
 * into the existing native `<form action={serverAction}>` pattern used across the app.
 * Until the user clicks, it follows `fallbackLatitude`/`fallbackLongitude` (e.g. the
 * selected marina's stored point) so switching a dropdown re-centers the map.
 */
export function LocationPicker({
  latName,
  lngName,
  initialLatitude,
  initialLongitude,
  fallbackLatitude,
  fallbackLongitude,
  hint,
}: {
  latName: string;
  lngName: string;
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  fallbackLatitude?: number | null;
  fallbackLongitude?: number | null;
  hint?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const hasManualPinRef = useRef(initialLatitude != null && initialLongitude != null);

  const [position, setPosition] = useState<[number, number] | null>(
    initialLatitude != null && initialLongitude != null
      ? [initialLatitude, initialLongitude]
      : fallbackLatitude != null && fallbackLongitude != null
        ? [fallbackLatitude, fallbackLongitude]
        : null,
  );

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
        setPosition(next);
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

  // Follow the fallback (e.g. selected marina) until the user places their own pin.
  useEffect(() => {
    if (hasManualPinRef.current) return;
    if (fallbackLatitude == null || fallbackLongitude == null) return;
    const next: [number, number] = [fallbackLatitude, fallbackLongitude];
    setPosition(next);

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
      <input type="hidden" name={latName} value={position ? position[0] : ""} readOnly />
      <input type="hidden" name={lngName} value={position ? position[1] : ""} readOnly />
    </div>
  );
}
