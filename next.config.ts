import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  images: {
    // Vessel photos are pasted by owners as arbitrary URLs (no storage upload
    // flow yet — see vessel-images-manager.tsx), so the host isn't known in
    // advance. Without this, next/image rejects any non-local src in prod.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
