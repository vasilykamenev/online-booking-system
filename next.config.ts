import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Vessel photos are served from Supabase Storage's public object URLs
// (see supabase/migrations/20260818150001_vessel_images_storage.sql).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseRemotePattern = supabaseUrl
  ? (() => {
      const url = new URL(supabaseUrl);
      return {
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        port: url.port || undefined,
        pathname: "/storage/v1/object/public/**" as const,
      };
    })()
  : undefined;

const nextConfig: NextConfig = {
  images: {
    // External search-source photos (brilions.com and any future source approved through
    // /admin/search-sources) are never listed here — they're proxied same-origin through
    // src/app/api/external-image/route.ts, which is what lets a newly approved source's photos
    // render without a code change/deploy. Only trusted first-party storage belongs in this list.
    remotePatterns: [...(supabaseRemotePattern ? [supabaseRemotePattern] : [])],
    // Next.js 16 requires a same-origin `src` carrying a query string to be explicitly allow-listed
    // (breaking change, "Local Images with Query Strings") — the external-image proxy's `?url=...`
    // is exactly that. `search` is deliberately omitted rather than pinned to a literal value: the
    // proxied URL varies per photo, and next/image's LocalPattern.search only matches an exact
    // string, no wildcard. That's safe here specifically because the route itself (not this config)
    // is what actually gates which URLs it will fetch — allowlisted source domain, content-type,
    // SSRF-safe fetch (see external-image/route.ts) — this pattern only says "yes, optimize a local
    // path under this one route", not "trust whatever the query string points at".
    localPatterns: [
      // Setting `localPatterns` at all switches next/image from "any local src is fine" to an
      // allowlist — so every other local image this app already renders (logo, favicons, anything
      // under /public) needs its own entry, not just the one that motivated adding this array.
      { pathname: "/**", search: "" },
      { pathname: "/api/external-image" },
    ],
    // Local Supabase Storage serves images from 127.0.0.1 — dev-only, never in production,
    // where NEXT_PUBLIC_SUPABASE_URL points at a real (non-private-IP) domain.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);