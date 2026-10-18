/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
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
