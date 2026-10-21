import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import https from "node:https";
import type { RequestListener } from "node:http";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// "Check my site" fetches an address a person typed, from our server. It must never be turned into a way of reaching
// our own network or cloud metadata, however the address is written, redirected or answered by DNS.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => (sess.user ? { user: sess.user } : null), getCurrentUserId: async () => sess.user?.id ?? null }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { isPrivateAddress, ipv6Bytes, checkSite, pinnedGet, pinnedLookup, MAX_PAGE_BYTES, type Fetcher, type Page } from "@/lib/support/site-check";
import { POST as checkRoute } from "@/app/api/projects/[id]/support/check-site/route";

describe("which addresses count as private", () => {
  it("IPv4: private, loopback, link-local (cloud metadata), shared, test and reserved ranges", () => {
    for (const ip of ["0.0.0.0", "10.0.0.1", "10.255.255.255", "127.0.0.1", "127.8.8.8", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255", "192.0.0.1", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1", "240.0.0.1", "255.255.255.255"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "198.17.0.1", "198.51.101.1", "203.0.114.1", "192.169.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it("IPv6: loopback, unique-local, link-local, multicast and the unspecified address", () => {
    for (const ip of ["::", "::1", "0:0:0:0:0:0:0:1", "fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1", "fec0::1", "ff02::1", "100::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("IPv6 wrapping an IPv4 address, in every way of writing it, is judged by the IPv4 inside", () => {
    // ::ffff:127.0.0.1 is the same as ::ffff:7f00:1, and that second spelling used to get through
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::FFFF:7F00:1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:c0a8:1", "::ffff:a9fe:a9fe", "::ffff:169.254.169.254", "::127.0.0.1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b::8.8.8.8"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false);
  });
  it("IPv6 transition and special blocks are refused (6to4, Teredo, documentation, benchmarking)", () => {
    for (const ip of ["2002:7f00:1::", "2002:a9fe:a9fe::1", "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "2001:2::1", "2001:10::1", "3fff::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("public IPv6 addresses are allowed", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:81b::200e", "2620:fe::fe"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("anything that is not a plain address is refused", () => {
    for (const ip of ["", "abc", "1.2.3", "999.1.1.1", "[::1]", "fe80::1%eth0", "::1::2", "1:2:3:4:5:6:7:8:9", "0x7f.0.0.1", "2130706433", "::ffff:127.0.0.1.5", "localhost"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("reads IPv6 into bytes", () => {
    expect(ipv6Bytes("::1")).toEqual([...Array(15).fill(0), 1]);
    expect(ipv6Bytes("::ffff:127.0.0.1")?.slice(10)).toEqual([255, 255, 127, 0, 0, 1]);
    expect(ipv6Bytes("::ffff:7f00:1")?.slice(10)).toEqual([255, 255, 127, 0, 0, 1]);
    expect(ipv6Bytes("2001:db8::ff00:42:8329")?.slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8]);
    expect(ipv6Bytes("1.2.3.4")).toBeNull();
    expect(ipv6Bytes("fe80::1%1")).toBeNull();
  });
});

const ok = (body = "", status = 200): Page => ({ status, location: null, body });
const publicLookup = async () => ["93.184.216.34"];

describe("which addresses are accepted", () => {
  it("only https on the normal port, no logins, no raw addresses", async () => {
    const f = vi.fn() as unknown as Fetcher;
    for (const bad of ["https://shop.example.com:8443/", "https://shop.example.com:22", "https://shop.example.com:6379/x", "https://user:pw@shop.example.com", "http://shop.example.com", "ftp://shop.example.com", "file:///etc/passwd", "gopher://x.com"]) {
      expect((await checkSite(bad, "k", [], f, publicLookup)).status, bad).toBe("invalid");
    }
    for (const raw of ["https://127.0.0.1/", "https://[::1]/", "https://[::ffff:7f00:1]/", "https://2130706433/", "https://0x7f.1/", "https://017700000001/", "https://169.254.169.254/latest/meta-data/", "https://[fd00::1]/"]) {
      expect((await checkSite(raw, "k", [], f, publicLookup)).status, raw).toBe("blocked");
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("an explicit :443 is just the normal port", async () => {
    expect((await checkSite("https://shop.example.com:443/", "k", [], async () => ok("x"), publicLookup)).status).toBe("ok");
  });
  it("internal-looking names are refused without even looking them up", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34"]);
    const f = vi.fn() as unknown as Fetcher;
    for (const name of ["localhost", "localhost.", "app.localhost", "intranet", "printer.local", "metadata.google.internal", "nas.home.arpa", "router.lan", "db.corp", "x.localdomain"]) {
      expect((await checkSite(`https://${name}/`, "k", [], f, lookup)).status, name).toBe("blocked");
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("a name that points inside", () => {
  it("is refused when any of its addresses is private (mixed answers)", async () => {
    const f = vi.fn() as unknown as Fetcher;
    expect((await checkSite("https://evil.example", "k", [], f, async () => ["93.184.216.34", "10.0.0.5"])).status).toBe("blocked");
    expect((await checkSite("https://evil.example", "k", [], f, async () => ["::ffff:7f00:1"])).status).toBe("blocked");
    expect((await checkSite("https://evil.example", "k", [], f, async () => [])).status).toBe("blocked");
    expect((await checkSite("https://evil.example", "k", [], f, async () => { throw new Error("nxdomain"); })).status).toBe("blocked");
    expect(f).not.toHaveBeenCalled();
  });
  it("DNS rebinding: the name is resolved ONCE and the request goes to the checked address, never to the name again", async () => {
    let answers = 0;
    const lookup = vi.fn(async () => (++answers === 1 ? ["93.184.216.34"] : ["127.0.0.1"])); // public first, then 'inside'
    const seen: { host: string; addresses: string[] }[] = [];
    const fetcher: Fetcher = async (url, addresses) => { seen.push({ host: url.hostname, addresses }); return ok(`<script src="https://ideahq.cloud/embed/k.js"></script>`); };
    const res = await checkSite("https://rebind.example", "k", [], fetcher, lookup);
    expect(res).toMatchObject({ status: "ok", found: true });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ host: "rebind.example", addresses: ["93.184.216.34"] }]);
  });
});

describe("redirects", () => {
  const redirect = (location: string, status = 302): Page => ({ status, location, body: "" });
  it("every hop is checked again, and stops at 4", async () => {
    const lookup = vi.fn(async (h: string) => (h === "inner.example" ? ["10.0.0.1"] : ["93.184.216.34"]));
    const hops = vi.fn(async (u: URL) => (u.hostname === "start.example" ? redirect("https://inner.example/x") : ok("fine")));
    expect((await checkSite("https://start.example/", "k", [], hops, lookup)).status).toBe("blocked");
    expect(hops).toHaveBeenCalledTimes(1);
    const loop = vi.fn(async () => redirect("https://loop.example/again"));
    expect((await checkSite("https://loop.example/", "k", [], loop, publicLookup)).status).toBe("unreachable");
    expect(loop).toHaveBeenCalledTimes(4);
  });
  it("a redirect to a raw address, another port, plain http, a login or garbage is not followed", async () => {
    for (const target of ["https://127.0.0.1/", "https://[::ffff:7f00:1]/", "https://169.254.169.254/latest/", "https://shop.example.com:8443/", "http://shop.example.com/", "https://u:p@shop.example.com/", "file:///etc/passwd", "gopher://x"]) {
      const f = vi.fn(async () => redirect(target));
      const res = await checkSite("https://shop.example.com/", "k", [], f, publicLookup);
      expect(["blocked", "unreachable"], target).toContain(res.status);
      expect(f, target).toHaveBeenCalledTimes(1);
    }
  });
  it("a relative redirect on the same site works, and a redirect with no target is unreachable", async () => {
    const f = vi.fn(async (u: URL) => (u.pathname === "/" ? redirect("/home") : ok("shop")));
    expect((await checkSite("https://shop.example.com/", "k", ["https://shop.example.com"], f, publicLookup))).toMatchObject({ status: "ok", allowed: true });
    expect((await checkSite("https://shop.example.com/", "k", [], async () => ({ status: 302, location: null, body: "" }), publicLookup)).status).toBe("unreachable");
  });
});

describe("what comes back", () => {
  it("only yes/no signals, and only the first 1.5 MB of a page is read", async () => {
    const late = "x".repeat(MAX_PAGE_BYTES) + `<script src="https://ideahq.cloud/embed/k.js"></script>`;
    expect(await checkSite("https://shop.example.com", "k", [], async () => ok(late), publicLookup)).toEqual({ status: "ok", found: false, allowed: false, origin: "https://shop.example.com" });
    const res = await checkSite("https://shop.example.com", "k", [], async () => ok("<title>secret internal page</title>"), publicLookup);
    expect(JSON.stringify(res)).not.toContain("secret internal page");
  });
  it("an error status, a thrown error and a missing page are all just 'unreachable'", async () => {
    for (const f of [async () => ok("", 404), async () => ok("", 500), async () => ok("", 0), async () => { throw new Error("ECONNREFUSED 10.0.0.1:22"); }]) {
      expect((await checkSite("https://shop.example.com", "k", [], f as Fetcher, publicLookup)).status).toBe("unreachable");
    }
  });
});

describe("the real connection", () => {
  const dir = mkdtempSync(join(tmpdir(), "sitecheck-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // A throwaway certificate for shop.test (a name that does not exist in DNS).
  const conf = join(dir, "c.cnf");
  writeFileSync(conf, "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=shop.test\n[v3]\nsubjectAltName=DNS:shop.test\n");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "2", "-config", conf], { stdio: "ignore" });
  const cert = readFileSync(join(dir, "c.pem"), "utf8");
  const key = readFileSync(join(dir, "k.pem"), "utf8");

  async function serve(handler: RequestListener) {
    const seen = { sni: [] as string[] };
    const server = https.createServer({ key, cert }, handler);
    server.on("secureConnection", (s) => seen.sni.push((s as unknown as { servername?: string }).servername ?? ""));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { server, port: (server.address() as net.AddressInfo).port, seen, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
  }

  it("connects to the checked address whatever the name resolves to, with the right Host and certificate name", async () => {
    let hostHeader = "";
    const s = await serve((req, res) => { hostHeader = String(req.headers.host); res.end(`path=${req.url}`); });
    try {
      // "shop.test" has no DNS entry at all: reaching the server proves the connection was pinned to the address given.
      const page = await pinnedGet({ ca: cert })(new URL(`https://shop.test:${s.port}/page?q=1`), ["127.0.0.1"]);
      expect(page).toEqual({ status: 200, location: null, body: "path=/page?q=1" });
      expect(hostHeader).toBe(`shop.test:${s.port}`);
      expect(s.seen.sni).toContain("shop.test");
    } finally { await s.close(); }
  });
  it("still checks the certificate against the NAME (pinning the address does not switch verification off)", async () => {
    const s = await serve((_req, res) => res.end("hi"));
    try {
      await expect(pinnedGet({ ca: cert })(new URL(`https://other.test:${s.port}/`), ["127.0.0.1"])).rejects.toThrow();
      await expect(pinnedGet()(new URL(`https://shop.test:${s.port}/`), ["127.0.0.1"])).rejects.toThrow(); // not trusted without the test CA
    } finally { await s.close(); }
  });
  it("hands a redirect back instead of following it, and stops reading at the size limit", async () => {
    const s = await serve((req, res) => {
      if (req.url === "/r") { res.writeHead(301, { location: "https://elsewhere.example/" }); return res.end(); }
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = "a".repeat(64 * 1024);
      let sent = 0;
      const write = () => { while (sent < 6_000_000) { sent += chunk.length; if (!res.write(chunk)) return void res.once("drain", write); } res.end(); };
      write();
    });
    try {
      expect(await pinnedGet({ ca: cert })(new URL(`https://shop.test:${s.port}/r`), ["127.0.0.1"])).toMatchObject({ status: 301, location: "https://elsewhere.example/" });
      const big = await pinnedGet({ ca: cert })(new URL(`https://shop.test:${s.port}/big`), ["127.0.0.1"]);
      expect(big.status).toBe(200);
      expect(big.body.length).toBeGreaterThanOrEqual(MAX_PAGE_BYTES);
      expect(big.body.length).toBeLessThan(MAX_PAGE_BYTES + 200_000);
    } finally { await s.close(); }
  });
  it("tries the next checked address when the first one refuses the connection", async () => {
    const s = await serve((_req, res) => res.end("second"));
    try {
      // the server listens on 127.0.0.1 only, so ::1 is refused at once and the second address is used
      const page = await pinnedGet({ ca: cert })(new URL(`https://shop.test:${s.port}/`), ["::1", "127.0.0.1"]);
      expect(page.body).toBe("second");
    } finally { await s.close(); }
  });
  it("the pinned lookup answers with the given address for any name, in both shapes Node asks for", () => {
    const one = vi.fn();
    pinnedLookup("93.184.216.34")("anything.example", {}, one);
    expect(one).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const all = vi.fn();
    pinnedLookup("2606:4700::1")("anything.example", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "2606:4700::1", family: 6 }]);
  });
});

describe("the route", () => {
  const call = (url?: unknown) => checkRoute(new Request("https://x", { method: "POST", body: JSON.stringify(url === undefined ? {} : { url }) }), { params: Promise.resolve({ id: "p1" }) });
  beforeEach(async () => {
    await resetDb();
    process.env.OWNER_EMAIL = "ann@x.se";
    sess.user = { id: "u1", email: "ann@x.se" };
    await db.user.create({ data: { id: "u1", email: "ann@x.se", approved: true } });
    await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "" } });
    await db.supportSpace.create({ data: { projectId: "p1", publicKey: "ihq_s_AAAAAAAAAAAAAAAA", allowedOrigins: [] } });
  });
  it("is rationed to 20 checks an hour per person", async () => {
    for (let i = 0; i < 20; i++) expect((await (await call()).json()).status, `check ${i + 1}`).toBe("invalid");
    expect(await (await call()).json()).toEqual({ status: "limited" });
    sess.user = { id: "u2", email: "bea@x.se" };
    await db.user.create({ data: { id: "u2", email: "bea@x.se", approved: true, features: ["tickets"] } });
    await db.project.create({ data: { id: "p2", userId: "u2", name: "B", slug: "b", context: "" } });
    await db.supportSpace.create({ data: { projectId: "p2", publicKey: "ihq_s_BBBBBBBBBBBBBBBB", allowedOrigins: [] } });
    const other = await checkRoute(new Request("https://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "p2" }) });
    expect((await other.json()).status).toBe("invalid"); // someone else is not affected
  });
  it("refuses internal addresses end to end, before any network request", async () => {
    for (const u of ["https://127.0.0.1/", "https://[::ffff:7f00:1]/", "https://localhost/", "https://169.254.169.254/"]) expect((await (await call(u)).json()).status, u).toBe("blocked");
  });
});
