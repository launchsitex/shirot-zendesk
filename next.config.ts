import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js 16 defaults to Turbopack; keep config empty unless Turbopack options are needed.
  turbopack: {},
};

export default nextConfig;
