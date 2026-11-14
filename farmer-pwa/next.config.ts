import type { NextConfig } from "next";

const fastApiOrigin = process.env.FASTAPI_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${fastApiOrigin}/api/:path*` },
      { source: "/weather/:path*", destination: `${fastApiOrigin}/weather/:path*` },
    ];
  },
};

export default nextConfig;
