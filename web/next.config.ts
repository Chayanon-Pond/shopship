import type { NextConfig } from "next";

/** HSTS only when the canonical site is https (never for local http builds). */
const siteIsHttps = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(siteIsHttps ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

/** API media origin (product photos served from `${origin}/media/**`) for next/image optimisation. */
function mediaRemotePatterns() {
  const origin = process.env.NEXT_PUBLIC_MEDIA_ORIGIN;
  if (!origin) return [];
  try {
    const u = new URL(origin);
    return [
      {
        protocol: u.protocol.replace(":", "") as "http" | "https",
        hostname: u.hostname,
        port: u.port,
        pathname: "/media/**",
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Local dev only: the API media origin is http://localhost:<port>, which Next 16's optimizer refuses (private IP / SSRF
 * guard) → every uploaded photo 400s. Allow it only when the configured media origin itself is a loopback host.
 */
function mediaIsLoopback() {
  try {
    const h = new URL(process.env.NEXT_PUBLIC_MEDIA_ORIGIN ?? "").hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}

const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (web/Dockerfile).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: mediaRemotePatterns(),
    dangerouslyAllowLocalIP: mediaIsLoopback(),
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: noindex },
      { source: "/account/:path*", headers: noindex },
      { source: "/checkout/:path*", headers: noindex },
    ];
  },
};

export default nextConfig;
