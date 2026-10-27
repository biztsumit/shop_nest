import path from "node:path";
import type { NextConfig } from "next";
import { apiUrl } from "./src/lib/api-url";

// Where the NestJS API runs (apps/api). Only the Next server talks to it directly.
const API_URL = apiUrl();

// Where product photos may come from. next/image resizes photos on our server, so it only
// accepts listed hosts: otherwise anyone could use the shop to resize any image on the web.
// (picsum.photos redirects to fastly.picsum.photos: both are needed for the demo photos.)
const IMAGE_HOSTS = (process.env.IMAGE_HOSTS ?? "picsum.photos,fastly.picsum.photos,images.unsplash.com")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,

  // Docker builds set NEXT_OUTPUT=standalone: a self-contained server folder with only the
  // files it needs (see apps/web/Dockerfile). In a monorepo, file tracing must start at the
  // repository root, or the shared package would be left out.
  ...(process.env.NEXT_OUTPUT === "standalone" && {
    output: "standalone" as const,
    outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  }),

  images: {
    remotePatterns: IMAGE_HOSTS.map((hostname) => ({ protocol: "https", hostname })),
  },

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
