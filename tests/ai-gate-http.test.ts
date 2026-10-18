import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({ result: "ok" as "ok" | "limit" | "off" }));
vi.mock("@/lib/access", async () => {
  const real = await vi.importActual<typeof import("@/lib/access")>("@/lib/access");
  return { ...real, consumeAiCallDetailed: async () => st.result };
});
vi.mock("@/lib/session", () => ({ getSession: async () => null }));

import { requireAiCall, requireAi } from "@/lib/runs/http";

beforeEach(() => {
  st.result = "ok";
  process.env.ANTHROPIC_API_KEY = "k";
});

describe("helper AI gate responses", () => {
  it("lets an allowed call through", async () => {
    expect(await requireAiCall("u", "u@x.se")).toBeNull();
    expect(await requireAi("u", "u@x.se")).toBeNull();
  });
  it("a used-up allowance is a 429 with the tomorrow message", async () => {
    st.result = "limit";
    const res = (await requireAiCall("u", "u@x.se"))!;
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Daily AI limit reached/);
  });
  it("a limit of 0 is a 403 that says helpers are switched off, not 'limit reached'", async () => {
    st.result = "off";
    const res = (await requireAi("u", "u@x.se"))!;
    expect(res.status).toBe(403);
    const msg = (await res.json()).error as string;
    expect(msg).toMatch(/switched off/);
    expect(msg).not.toMatch(/limit reached/i);
  });
  it("a missing server key is a 503 and does not count a call", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    st.result = "limit";
    expect((await requireAi("u", "u@x.se"))!.status).toBe(503);
  });
});
