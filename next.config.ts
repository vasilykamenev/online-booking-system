import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

<<<<<<< HEAD
const nextConfig: NextConfig = {
  images: {
    // Vessel photos are pasted by owners as arbitrary URLs (no storage upload
    // flow yet — see vessel-images-manager.tsx), so the host isn't known in
    // advance. Without this, next/image rejects any non-local src in prod.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
=======
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
>>>>>>> develop
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
