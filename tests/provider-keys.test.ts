import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sodium from "libsodium-wrappers";
import { makeFakeDb } from "./fakedb";
import { SecretsPermissionError } from "@/lib/github/client";
import { sealSecret } from "@/lib/github/seal";

const holder = vi.hoisted(() => ({ db: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_t, k) => holder.db[k as string] }) }));

import { relayProviderKey, redact, clearRelayLimits } from "@/lib/provider-keys";
import { clearSetupCache } from "@/lib/runs/setup-cache";
import { openai } from "@/lib/providers";

const KEY = "sk-test-SECRET-KEY-1234567890abcdef";
let t: ReturnType<typeof makeFakeDb>;
let writes: { repo: string; name: string; value: string; keyId: string }[];
let logged: string[];

const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
const status = (n: number) => (async () => new Response("{}", { status: n })) as unknown as typeof fetch;

function gh(over: Record<string, unknown> = {}) {
  return {
    getSecretsPublicKey: async () => ({ keyId: "kid", key: "PUBKEY" }),
    putSecret: async (_i: number, o: string, r: string, name: string, value: string, keyId: string) => { writes.push({ repo: `${o}/${r}`, name, value, keyId }); },
    ...over,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const seal = async (_pk: string, v: string) => `sealed(${v.length})`;
const proj = (id: string, repo: string, over: Record<string, unknown> = {}) => ({ id, userId: "u1", name: id, installationId: 5, repoOwner: "acme", repoName: repo, aiProvider: "claude", secretConfirmed: false, ...over });

beforeEach(() => {
  t = makeFakeDb(); holder.db = t.db; writes = []; logged = [];
  clearRelayLimits(); clearSetupCache();
  process.env.OPENAI_PROVIDER_ENABLED = "1";
  for (const m of ["log", "error", "warn", "info", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
  t.tables.project.push(proj("p1", "app", { aiProvider: "openai" }), proj("p2", "other"), proj("pX", "theirs", { userId: "u2" }));
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.OPENAI_PROVIDER_ENABLED; });

describe("sealed box", () => {
  it("round-trips: only the holder of the repo's private key can open it", async () => {
    await sodium.ready;
    const kp = sodium.crypto_box_keypair();
    const pub = sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL);
    const sealed = await sealSecret(pub, KEY);
    expect(sealed).not.toContain(KEY);
    const opened = sodium.crypto_box_seal_open(sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey);
    expect(sodium.to_string(opened)).toBe(KEY);
  });
  it("produces different ciphertext each time", async () => {
    await sodium.ready;
    const pub = sodium.to_base64(sodium.crypto_box_keypair().publicKey, sodium.base64_variants.ORIGINAL);
    expect(await sealSecret(pub, KEY)).not.toBe(await sealSecret(pub, KEY));
  });
});

describe("relayProviderKey", () => {
  it("validates the key, seals it, writes the secret with the right name, and marks the project's key as present", async () => {
    const r = await relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, { gh: gh(), fetchImpl: okFetch, seal });
    expect(r.results).toEqual([{ projectId: "p1", repo: "acme/app", ok: true, message: "Saved as OPENAI_API_KEY." }]);
    expect(writes).toEqual([{ repo: "acme/app", name: "OPENAI_API_KEY", value: "sealed(" + KEY.length + ")", keyId: "kid" }]);
    expect(t.tables.project.find((p) => p.id === "p1")!.secretConfirmed).toBe(true);
  });

  it("rejects a key the vendor refuses BEFORE writing anything", async () => {
    await expect(relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, { gh: gh(), fetchImpl: status(401), seal })).rejects.toThrow(/rejected this key/);
    expect(writes).toHaveLength(0);
  });

  it("covers the user's other projects too, but never someone else's, never duplicates a repo", async () => {
    t.tables.project.push(proj("p3", "app")); // same repo as p1
    const r = await relayProviderKey("u1", "p1", { provider: "openai", key: KEY, alsoProjectIds: ["p2", "p3", "pX", "nope"] }, { gh: gh(), fetchImpl: okFetch, seal });
    expect(writes.map((w) => w.repo).sort()).toEqual(["acme/app", "acme/other"]);
    expect(r.results).toHaveLength(2);
  });

  it("is not available for another user's project", async () => {
    await expect(relayProviderKey("u2", "p1", { provider: "openai", key: KEY }, { gh: gh(), fetchImpl: okFetch, seal })).rejects.toMatchObject({ status: 404 });
    expect(writes).toHaveLength(0);
  });

  it("falls back with a clear message when the app lacks Secrets: write", async () => {
    const r = await relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, { gh: gh({ putSecret: async () => { throw new SecretsPermissionError(); } }), fetchImpl: okFetch, seal });
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].message).toMatch(/Approve the new permission|by hand/);
    expect(t.tables.project.find((p) => p.id === "p1")!.secretConfirmed).toBe(false);
  });

  it("one repo failing does not stop the others, and says which failed", async () => {
    let n = 0;
    const r = await relayProviderKey("u1", "p1", { provider: "openai", key: KEY, alsoProjectIds: ["p2"] }, { gh: gh({ putSecret: async (...a: unknown[]) => { if (n++ === 0) throw new Error("boom"); writes.push({ repo: `${a[1]}/${a[2]}`, name: String(a[3]), value: "", keyId: "" }); } }), fetchImpl: okFetch, seal });
    expect(r.results.map((x) => x.ok)).toEqual([false, true]);
  });

  it("refuses unknown or switched-off providers, empty and oversized keys", async () => {
    await expect(relayProviderKey("u1", "p1", { provider: "gemini", key: KEY }, { gh: gh(), seal })).rejects.toMatchObject({ status: 400 });
    delete process.env.OPENAI_PROVIDER_ENABLED;
    await expect(relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, { gh: gh(), seal })).rejects.toThrow(/not available yet/);
    process.env.OPENAI_PROVIDER_ENABLED = "1";
    await expect(relayProviderKey("u1", "p1", { provider: "openai", key: "  " }, { gh: gh(), seal })).rejects.toThrow(/Paste your API key/);
    await expect(relayProviderKey("u1", "p1", { provider: "openai", key: "x".repeat(500) }, { gh: gh(), seal })).rejects.toThrow(/too long/);
    expect(writes).toHaveLength(0);
  });

  it("rate limits repeated attempts per user", async () => {
    for (let i = 0; i < 12; i++) await relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, { gh: gh(), fetchImpl: okFetch, seal, now: () => 1000 + i }).catch(() => undefined);
    await expect(relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, { gh: gh(), fetchImpl: okFetch, seal, now: () => 5000 })).rejects.toMatchObject({ status: 429 });
    // an hour later it works again
    await expect(relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, { gh: gh(), fetchImpl: okFetch, seal, now: () => 1000 + 61 * 60 * 1000 })).resolves.toBeTruthy();
  });
});

describe("the key never leaks (review D2)", () => {
  it("is not in the results, not in any error message, not in any log line, not in the database", async () => {
    const leaky = gh({ putSecret: async () => { throw new Error(`GitHub said no for ${KEY}`); } });
    const r = await relayProviderKey("u1", "p1", { provider: "openai", key: KEY, alsoProjectIds: ["p2"] }, { gh: leaky, fetchImpl: okFetch, seal });
    expect(JSON.stringify(r)).not.toContain(KEY);
    const rejected = await relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, { gh: gh(), seal, fetchImpl: (async () => { throw new Error(`network down ${KEY}`); }) as unknown as typeof fetch }).catch((e: Error) => e.message);
    expect(String(rejected)).not.toContain(KEY);
    expect(logged.join("\n")).not.toContain(KEY);
    expect(JSON.stringify(t.tables)).not.toContain(KEY);
  });
  it("redact removes every occurrence", () => {
    expect(redact(`a ${KEY} b ${KEY}`, KEY)).toBe("a [key hidden] b [key hidden]");
    expect(redact("nothing here", "")).toBe("nothing here");
  });
});

describe("validateKey", () => {
  it("accepts a key the vendor accepts and rejects bad shapes without any network call", async () => {
    expect(await openai.validateKey(KEY, okFetch)).toEqual({ ok: true });
    const never = (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch;
    expect((await openai.validateKey("short", never)).ok).toBe(false);
    expect((await openai.validateKey("has spaces in it and is long enough", never)).ok).toBe(false);
  });
  it("distinguishes a rejected key from a vendor outage", async () => {
    expect((await openai.validateKey(KEY, status(401))).reason).toMatch(/rejected/);
    expect((await openai.validateKey(KEY, status(500))).reason).toMatch(/Try again/);
    expect((await openai.validateKey(KEY, (async () => { throw new Error("x"); }) as unknown as typeof fetch)).reason).toMatch(/Could not reach/);
  });
});
