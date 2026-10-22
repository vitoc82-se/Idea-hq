import path from "node:path";

/** @type {import('next').NextConfig} */
// What the app's own pages may load. Next.js puts small inline scripts and styles into every page, so those are
// allowed ('unsafe-inline'); everything else is limited to this site, plus Cloudflare's "are you a person" check on
// the sign-up form. No eval, no plugins, nobody may frame the app except itself. (The public help pages, the ticket
// pages and the embed script set their own stricter policies in src/lib/support/page-shell.ts.)
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

// Running on your own machine with the in-memory database (scripts/local.mjs): the build uses src/lib/db-pglite.ts in
// place of src/lib/db.ts. Nothing here applies to a normal build.
const localDb = process.env.IDEAHQ_DB === "pglite";
const DB_FILE = path.resolve("src/lib/db.ts");
const LOCAL_DB_FILE = path.resolve("src/lib/db-pglite.ts");
class UseLocalDatabase {
  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap("UseLocalDatabase", (factory) => {
      factory.hooks.afterResolve.tap("UseLocalDatabase", (data) => {
        if (data.createData?.resource === DB_FILE) data.createData.resource = LOCAL_DB_FILE;
      });
    });
  }
}

// The dev server's hot reloading needs eval; a production build never gets it.
const csp = process.env.NODE_ENV === "development" ? APP_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'") : APP_CSP;

const nextConfig = {
  ...(localDb
    ? {
        serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"],
        webpack(config) {
          config.plugins.push(new UseLocalDatabase());
          return config;
        },
      }
    : {}),
  // Do not tell the world which framework (and so which advisories) to try.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  // The one canonical address is ideahq.cloud. The old Vercel address redirects
  // there (temporary redirect, easy to undo). The GitHub webhook is exempt so a
  // stale App setting can never lose run updates.
  // Basic hardening for the app itself. The public Help pages and the embed script set their
  // own headers (they must be framable by the owner's own site), so they are left out here.
  async headers() {
    return [
      {
        source: "/((?!widget/|help/|t/|embed/|api/support/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path((?!api/github/webhook).*)",
        has: [{ type: "host", value: "idea-hq-three.vercel.app" }],
        destination: "https://ideahq.cloud/:path",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
