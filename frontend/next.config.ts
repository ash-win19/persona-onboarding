import type { NextConfig } from "next";
import { getBackendUrl } from "./src/lib/backend-url";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${getBackendUrl()}/:path*`,
      },
    ];
  },
};

export default nextConfig;
