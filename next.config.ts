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
    remotePatterns: supabaseRemotePattern ? [supabaseRemotePattern] : [],
    // Local Supabase Storage serves images from 127.0.0.1 — dev-only, never in production,
    // where NEXT_PUBLIC_SUPABASE_URL points at a real (non-private-IP) domain.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);