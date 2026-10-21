import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// The service worker must never keep a signed-in person's pages: only public files, plus an offline page.
type Listener = (e: unknown) => void;
type Req = { method: string; url: string; mode?: string };

function boot(opts: { network: (r: Req) => Promise<Response>; existingCaches?: Record<string, Map<string, Response>> }) {
  const listeners: Record<string, Listener> = {};
  const stores: Record<string, Map<string, Response>> = opts.existingCaches ?? {};
  const key = (r: Req | string) => (typeof r === "string" ? r : r.url).replace(/^https:\/\/ideahq\.cloud/, "");
  const caches = {
    open: async (name: string) => {
      stores[name] ??= new Map();
      return { add: async (u: string) => void stores[name].set(u, new Response("offline page")), put: async (r: Req, res: Response) => void stores[name].set(key(r), res) };
    },
    keys: async () => Object.keys(stores),
    delete: async (n: string) => delete stores[n],
    match: async (r: Req | string) => {
      for (const s of Object.values(stores)) if (s.has(key(r))) return s.get(key(r))!.clone();
      return undefined;
    },
  };
  const state = { skipped: false, claimed: false };
  const sandbox = {
    self: { location: { origin: "https://ideahq.cloud" }, addEventListener: (t: string, l: Listener) => (listeners[t] = l), skipWaiting: () => (state.skipped = true) },
    caches, clients: { claim: async () => (state.claimed = true) }, URL, Response,
    fetch: (r: Req) => opts.network(r),
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), sandbox);
  const run = async (type: string, e: Record<string, unknown> = {}) => {
    let waited: Promise<unknown> = Promise.resolve();
    let responded: Promise<Response> | null = null;
    listeners[type]({ ...e, waitUntil: (p: Promise<unknown>) => (waited = p), respondWith: (p: Promise<Response>) => (responded = Promise.resolve(p)) });
    await waited;
    return responded as Promise<Response> | null;
  };
  const request = (url: string, over: Partial<Req> = {}): Req => ({ method: "GET", url: `https://ideahq.cloud${url}`, ...over });
  return { stores, state, run, request };
}

const online = async (r: Req) => new Response(`page for ${r.url}`);
const offline = async () => { throw new TypeError("network down"); };

describe("service worker", () => {
  let sw: ReturnType<typeof boot>;
  beforeEach(() => { sw = boot({ network: online }); });

  it("on install, keeps only the offline page", async () => {
    await sw.run("install");
    expect(Object.keys(sw.stores["idea-hq-v2"])).toBeDefined();
    expect([...sw.stores["idea-hq-v2"].keys()]).toEqual(["/offline.html"]);
    expect(sw.state.skipped).toBe(true);
  });

  it("on activate, deletes the old cache that held signed-in pages", async () => {
    const old = boot({ network: online, existingCaches: { "idea-hq-v1": new Map([["/ideas", new Response("someone's private page")]]) } });
    await old.run("install");
    await old.run("activate");
    expect(Object.keys(old.stores)).toEqual(["idea-hq-v2"]);
    expect(old.state.claimed).toBe(true);
  });

  it("pages come from the network and are never stored", async () => {
    await sw.run("install");
    for (const path of ["/ideas", "/projects", "/settings", "/billing", "/support", "/users", "/welcome", "/"]) {
      const res = await sw.run("fetch", { request: sw.request(path, { mode: "navigate" }) });
      expect(await res!.text(), path).toBe(`page for https://ideahq.cloud${path}`);
    }
    expect([...sw.stores["idea-hq-v2"].keys()]).toEqual(["/offline.html"]);
  });

  it("offline, a page request gets the offline page, even if the page was visited before", async () => {
    await sw.run("install");
    await sw.run("fetch", { request: sw.request("/ideas", { mode: "navigate" }) });
    const down = boot({ network: offline, existingCaches: sw.stores });
    const res = await down.run("fetch", { request: down.request("/ideas", { mode: "navigate" }) });
    expect(await res!.text()).toBe("offline page");
  });

  it("only public files are kept: built scripts, icons, manifest", async () => {
    await sw.run("install");
    for (const path of ["/_next/static/chunks/app.js", "/icons/icon-192.png", "/manifest.json"]) await sw.run("fetch", { request: sw.request(path) });
    await new Promise((r) => setTimeout(r, 0));
    expect([...sw.stores["idea-hq-v2"].keys()].sort()).toEqual(["/_next/static/chunks/app.js", "/icons/icon-192.png", "/manifest.json", "/offline.html"]);
  });

  it("page data, uploads and everything else is neither handled nor stored", async () => {
    await sw.run("install");
    for (const path of ["/ideas?_rsc=abc", "/changes/ihq_c_x", "/t/token", "/widget/key", "/opengraph-image", "/some/other"]) {
      expect(await sw.run("fetch", { request: sw.request(path) }), path).toBeNull();
    }
    expect([...sw.stores["idea-hq-v2"].keys()]).toEqual(["/offline.html"]);
  });

  it("API calls, sign-in, other methods and other sites pass straight through", async () => {
    await sw.run("install");
    expect(await sw.run("fetch", { request: sw.request("/api/ideas") })).toBeNull();
    expect(await sw.run("fetch", { request: sw.request("/auth/signin", { mode: "navigate" }) })).toBeNull();
    expect(await sw.run("fetch", { request: sw.request("/ideas", { method: "POST", mode: "navigate" }) })).toBeNull();
    expect(await sw.run("fetch", { request: { method: "GET", url: "https://accounts.google.com/x" } })).toBeNull();
  });

  it("an error answer for a public file is not kept", async () => {
    const bad = boot({ network: async () => new Response("nope", { status: 500 }) });
    await bad.run("install");
    await bad.run("fetch", { request: bad.request("/_next/static/chunks/x.js") });
    await new Promise((r) => setTimeout(r, 0));
    expect([...bad.stores["idea-hq-v2"].keys()]).toEqual(["/offline.html"]);
  });
});
