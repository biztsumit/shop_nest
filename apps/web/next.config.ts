import type { NextConfig } from "next";

// Where the NestJS API runs (apps/api). Only the Next server talks to it directly.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,

  // The browser calls /api/... on THIS site, and Next forwards it to the API. So the browser
  // only ever sees one origin: no CORS preflights, and cookies can stay SameSite=Lax later.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
