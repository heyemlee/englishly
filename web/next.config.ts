import type { NextConfig } from "next";

// Two ways to run the web app:
// - While developing (`npm run dev`): this Next.js server proxies /api to the Python backend.
// - Always on (`npm run build:static`): plain static files in out/, which the backend serves itself next to /api, so
//   phones (through `tailscale serve`) and the extension reach everything through one address.
const EXPORT = process.env.PODECHO_EXPORT === "1";
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8811";

const server: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  async redirects() {
    // The practice page used to be /episodes/:id (backend/app/pages.py does the same for the static pages).
    return [{ source: "/episodes/:id", destination: "/episode?id=:id", permanent: false }];
  },
  experimental: {
    // Importing can take a while; the proxy default (30 s) would cut it off.
    proxyTimeout: 10 * 60 * 1000,
  },
};

const nextConfig: NextConfig = {
  ...(EXPORT ? { output: "export" } : server),
  // A static export can't prerender partially.
  cacheComponents: !EXPORT,
  partialPrefetching: !EXPORT,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Let phones on the home network and HTTPS tunnels load the dev server.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local", "**.ts.net"],
};

export default nextConfig;
