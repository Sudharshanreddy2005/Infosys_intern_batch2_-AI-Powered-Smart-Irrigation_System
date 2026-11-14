import type { NextConfig } from "next";
import path from "node:path";

const fastApiOrigin = process.env.FASTAPI_ORIGIN ?? "http://127.0.0.1:8000";
const workspaceRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  turbopack: { root: workspaceRoot },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${fastApiOrigin}/api/:path*` },
      { source: "/weather/:path*", destination: `${fastApiOrigin}/weather/:path*` },
    ];
  },
};

export default nextConfig;
