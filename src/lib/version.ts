import pkg from "../../package.json";

// The semver is hand-bumped in package.json; the commit id comes from the server environment on every Vercel deploy.
export function formatVersion(version: string, sha?: string | null): string {
  const sha7 = sha ? sha.slice(0, 7) : "";
  return sha7 ? `v${version} · ${sha7}` : `v${version}`;
}

// What every signed-in person sees in the menu: the version only. The exact build (the commit id) is not put in the
// page code, where anyone could read it; the owner sees it in Admin (see /api/admin/users).
export const APP_VERSION = formatVersion(pkg.version);
