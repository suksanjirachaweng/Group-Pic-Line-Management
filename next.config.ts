import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB; raised to fit header/field image uploads (capped at 5MB in lib/blob.ts).
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
