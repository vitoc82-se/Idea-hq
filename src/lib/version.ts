import pkg from "../../package.json";

// The semver is hand-bumped in package.json; the SHA updates automatically on every Vercel deploy.
export function formatVersion(version: string, sha?: string | null): string {
  const sha7 = sha ? sha.slice(0, 7) : "";
  return sha7 ? `v${version} · ${sha7}` : `v${version}`;
}

export const APP_VERSION = formatVersion(
  pkg.version,
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
);
