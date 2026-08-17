"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

const PIN_ICON_HTML = `
  <div style="transform: translate(-50%, -100%)">
    <svg width="30" height="38" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.716 23.284 0 15 0z" fill="var(--primary)"/>
      <circle cx="15" cy="15" r="5.5" fill="var(--primary-foreground)"/>
    </svg>
  </div>
`;

/** Read-only embedded map showing a single real-world point. OSM tiles — no API key required. */
export function LocationMap({
  latitude,
  longitude,
  label,
  className,
}: {
  latitude: number;
  longitude: number;
  label?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let map: import("leaflet").Map | undefined;

    (async () => {
      const leaflet = await import("leaflet");
      const L = leaflet.default ?? leaflet;
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        attributionControl: true,
      }).setView([latitude, longitude], 13);
      map.attributionControl.setPrefix(false);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const icon = L.divIcon({
        html: PIN_ICON_HTML,
        className: "",
        iconSize: [30, 38],
        iconAnchor: [15, 38],
      });
      const marker = L.marker([latitude, longitude], { icon }).addTo(map);
      if (label) marker.bindPopup(label);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [latitude, longitude, label]);

  return (
    <div
      ref={containerRef}
      className={className ?? "h-72 w-full overflow-hidden rounded-2xl border border-border md:h-96"}
    />
  );
}
