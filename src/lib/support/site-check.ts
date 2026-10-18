import dns from "dns/promises";
import net from "net";
import { normalizeOrigin } from "./sanitize";

// "Check my site": fetch the owner's page and look for the embed code. This is a
// server-side fetch of an address a user typed, so it refuses anything that
// resolves to a private or internal address and returns only yes/no signals.

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::" || l === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (mapped) return isPrivateAddress(mapped[1]);
    return l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb") || l.startsWith("64:ff9b");
  }
  return true; // not an address we understand: refuse
}

export type SiteCheck =
  | { status: "invalid" }
  | { status: "blocked" }
  | { status: "unreachable" }
  | { status: "ok"; found: boolean; allowed: boolean; origin: string };

type Lookup = (host: string) => Promise<string[]>;
const defaultLookup: Lookup = async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address);

async function safeHost(url: URL, lookup: Lookup): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return false; // no raw addresses
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  try {
    const addrs = await lookup(host);
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a));
  } catch {
    return false;
  }
}

export async function checkSite(
  input: unknown,
  key: string,
  allowedOrigins: string[],
  fetchImpl: typeof fetch = fetch,
  lookup: Lookup = defaultLookup
): Promise<SiteCheck> {
  if (typeof input !== "string" || input.length > 300) return { status: "invalid" };
  let u: URL;
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return { status: "invalid" };
  try {
    u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { status: "invalid" };
  }
  if (u.protocol !== "https:" || u.username || u.password) return { status: "invalid" };
  const origin = normalizeOrigin(u.origin);
  if (!origin) return { status: "invalid" };

  let current = u;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await safeHost(current, lookup))) return { status: "blocked" };
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "IdeaHQ-site-check/1.0" } });
    } catch {
      return { status: "unreachable" };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { status: "unreachable" };
      try {
        current = new URL(loc, current);
      } catch {
        return { status: "unreachable" };
      }
      if (current.protocol !== "https:") return { status: "unreachable" };
      continue;
    }
    if (!res.ok) return { status: "unreachable" };
    const text = (await res.text()).slice(0, 1_500_000);
    return { status: "ok", found: text.includes(`/embed/${key}.js`), allowed: allowedOrigins.includes(origin), origin };
  }
  return { status: "unreachable" };
}
