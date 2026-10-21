import dns from "dns/promises";
import https from "https";
import net from "net";
import { normalizeOrigin } from "./sanitize";

// "Check my site": fetch the owner's page and look for the embed code. This is a server-side request to an address a
// person typed, so it must never be turned into a way of reaching our own network or cloud metadata. Rules:
//  - the name is looked up ONCE; every address it gives must be public, and the request then connects to exactly
//    those addresses (not to the name again), so a name that answers differently the second time cannot slip through
//  - only https on the normal port, no raw addresses, no logins in the address
//  - every redirect goes through the same checks, at most 4
//  - the page is read up to a size limit; only yes/no signals are returned

// ---- which addresses are public ---------------------------------------------------------------------------------

function ipv4Private(a: number, b: number, c: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // this network, private, loopback, multicast and reserved
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99) || // protocol assignments, test nets, 6to4 relay
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) // benchmarking, documentation
  );
}

// "2001:db8::1", "::ffff:7f00:1", "::ffff:127.0.0.1", "::1" -> 16 bytes (null when it is not a plain IPv6 address)
export function ipv6Bytes(ip: string): number[] | null {
  if (!net.isIPv6(ip) || ip.includes("%")) return null;
  let text = ip.toLowerCase();
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const hex = (n: number) => n.toString(16);
    text = text.slice(0, tail.index) + `${hex((+tail[1] << 8) | +tail[2])}:${hex((+tail[3] << 8) | +tail[4])}`;
  }
  const [head, rest, extra] = text.split("::");
  if (extra !== undefined) return null;
  const groups = (s: string) => (s ? s.split(":") : []);
  const a = groups(head);
  const b = rest === undefined ? [] : groups(rest);
  if (rest === undefined ? a.length !== 8 : a.length + b.length > 7) return null;
  const all = rest === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  const bytes: number[] = [];
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 255);
  }
  return bytes.length === 16 ? bytes : null;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return ipv4Private(a, b, c);
  }
  const x = ipv6Bytes(ip);
  if (!x) return true; // not an address we understand: refuse
  const zeros = (from: number, to: number) => x.slice(from, to).every((v) => v === 0);
  // An IPv4 address wearing an IPv6 coat (::ffff:a.b.c.d, however it is written, e.g. ::ffff:7f00:1): judge the IPv4 inside.
  if (zeros(0, 10) && x[10] === 0xff && x[11] === 0xff) return ipv4Private(x[12], x[13], x[14]);
  // Everything else must be a global unicast address (2000::/3), and not one of the special blocks inside it.
  if ((x[0] & 0xe0) !== 0x20) return true; // ::, ::1, IPv4-compatible, NAT64 (64:ff9b::), unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8 ...
  if (x[0] === 0x20 && x[1] === 0x01 && x[2] < 0x02) return true; // 2001::/23: Teredo, benchmarking, ORCHID ...
  if (x[0] === 0x20 && x[1] === 0x01 && x[2] === 0x0d && x[3] === 0xb8) return true; // 2001:db8::/32 documentation
  if (x[0] === 0x20 && x[1] === 0x02) return true; // 2002::/16 6to4 (embeds an IPv4 address)
  if (x[0] === 0x3f && x[1] === 0xff && (x[2] & 0xf0) === 0) return true; // 3fff::/20 documentation
  return false;
}

// ---- looking up and fetching ------------------------------------------------------------------------------------

export type SiteCheck =
  | { status: "invalid" }
  | { status: "blocked" }
  | { status: "unreachable" }
  | { status: "limited" }
  | { status: "ok"; found: boolean; allowed: boolean; origin: string };

type Lookup = (host: string) => Promise<string[]>;
const defaultLookup: Lookup = async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address);

export type Page = { status: number; location: string | null; body: string };
// Gets one page, connecting ONLY to the given (already checked) addresses.
export type Fetcher = (url: URL, addresses: string[]) => Promise<Page>;

export const MAX_PAGE_BYTES = 1_500_000;
const TIMEOUT_MS = 5000;

// A connection that goes to `ip` whatever name was asked for. The certificate is still checked against the name.
export const pinnedLookup = (ip: string) => (_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
  opts && opts.all ? cb(null, [{ address: ip, family: net.isIPv6(ip) ? 6 : 4 }]) : cb(null, ip, net.isIPv6(ip) ? 6 : 4);

function getOnce(url: URL, ip: string, tls: { ca?: string }): Promise<Page> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.hostname,
        headers: { Host: url.host, "User-Agent": "IdeaHQ-site-check/1.0", Accept: "text/html,*/*;q=0.5", "Accept-Encoding": "identity" },
        lookup: pinnedLookup(ip) as never,
        timeout: TIMEOUT_MS,
        ...tls,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () => resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === "string" ? res.headers.location : null, body: Buffer.concat(chunks).toString("utf8") });
        res.on("data", (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size >= MAX_PAGE_BYTES) {
            res.destroy(); // enough: never read more than the limit
            finish();
          }
        });
        res.on("end", finish);
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export function pinnedGet(tls: { ca?: string } = {}): Fetcher {
  return async (url, addresses) => {
    let last: unknown = new Error("no address");
    for (const ip of addresses.slice(0, 3)) {
      try {
        return await getOnce(url, ip, tls);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  };
}

// The addresses to connect to when the name is safe to use, else null.
async function publicAddresses(url: URL, lookup: Lookup): Promise<string[] | null> {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host || net.isIP(host)) return null; // no raw addresses
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal|localdomain|lan|home\.arpa|intranet|corp)$/.test(host)) return null;
  try {
    const addrs = await lookup(host);
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a)) ? addrs : null;
  } catch {
    return null;
  }
}

export async function checkSite(
  input: unknown,
  key: string,
  allowedOrigins: string[],
  fetcher: Fetcher = pinnedGet(),
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
  // https on the normal port only: a custom port would make this a port scanner.
  if (u.protocol !== "https:" || u.username || u.password || u.port !== "") return { status: "invalid" };
  const origin = normalizeOrigin(u.origin);
  if (!origin) return { status: "invalid" };

  let current = u;
  for (let hop = 0; hop < 4; hop++) {
    const addresses = await publicAddresses(current, lookup);
    if (!addresses) return { status: "blocked" };
    let page: Page;
    try {
      page = await fetcher(current, addresses);
    } catch {
      return { status: "unreachable" };
    }
    if (page.status >= 300 && page.status < 400) {
      if (!page.location) return { status: "unreachable" };
      try {
        current = new URL(page.location, current);
      } catch {
        return { status: "unreachable" };
      }
      if (current.protocol !== "https:" || current.port !== "" || current.username || current.password) return { status: "unreachable" };
      continue;
    }
    if (page.status < 200 || page.status >= 300) return { status: "unreachable" };
    const text = page.body.slice(0, MAX_PAGE_BYTES);
    return { status: "ok", found: text.includes(`/embed/${key}.js`), allowed: allowedOrigins.includes(origin), origin };
  }
  return { status: "unreachable" };
}
