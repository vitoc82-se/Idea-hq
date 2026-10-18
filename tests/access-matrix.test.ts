import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import {
  makeDbProxy, calls, sessionRef, routeFiles, jsonRequest,
  OWNER, FRIEND, UNAPPROVED, MUSTCHANGE,
} from "./helpers";

vi.mock("@/lib/db", () => ({ db: makeDbProxy() }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sessionRef.user ? { user: sessionRef.user } : null),
  getCurrentUserId: async () => sessionRef.user?.id ?? null,
}));
vi.mock("next-auth", () => ({
  getServerSession: async () => (sessionRef.user ? { user: sessionRef.user } : null),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ROOT = path.resolve(__dirname, "../src/app/api");

// Routes that authenticate some other way (credentials flow, GitHub signature).
// The public support routes (customers, no login) and the cron route (bearer
// secret) are covered by tests/support-isolation.test.ts and support-routes.test.ts.
const NOT_SESSION_GATED = [/\/api\/auth\//, /\/api\/github\/webhook\//, /\/api\/onboarding\//, /\/api\/support\//, /\/api\/cron\//];
// Routes only the owner may use.
const OWNER_ONLY = [/\/api\/admin\//];

const routes = routeFiles().filter(
  (f) => !NOT_SESSION_GATED.some((re) => re.test(f.replace(ROOT, "/api") + "/"))
);

async function handlers(file: string) {
  const mod = await import(/* @vite-ignore */ file);
  return METHODS.filter((m) => typeof mod[m] === "function").map(
    (m) => [m, mod[m] as (r: Request, c: { params: Record<string, string> }) => Promise<Response>] as const
  );
}

async function call(h: (r: Request, c: { params: Record<string, string> }) => Promise<Response>, method: string) {
  try {
    return await h(jsonRequest(method), { params: { id: "target-id" } });
  } catch {
    return null; // a throw after the guard is irrelevant to access control
  }
}

const DATA_MODELS = ["idea", "project", "run"];
const dataCalls = () => calls.filter((c) => DATA_MODELS.includes(c.model));

beforeEach(() => {
  calls.length = 0;
  sessionRef.user = null;
  process.env.OWNER_EMAIL = OWNER.email;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("every session-gated route", () => {
  it("discovers the routes (guards against an empty matrix)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(9);
  });

  for (const file of routes) {
    const label = file.replace(ROOT, "api");
    const ownerOnly = OWNER_ONLY.some((re) => re.test(file.replace(ROOT, "/api") + "/"));

    describe(label, () => {
      it("denies anonymous, unapproved and must-change users, touching no data", async () => {
        for (const who of [null, UNAPPROVED, MUSTCHANGE]) {
          for (const [m, h] of await handlers(file)) {
            calls.length = 0;
            sessionRef.user = who ? { id: who.id, email: who.email } : null;
            const res = await call(h, m);
            expect(res?.status, `${m} as ${who?.id ?? "anon"}`).toBe(401);
            expect(dataCalls(), `${m} as ${who?.id ?? "anon"} touched data`).toHaveLength(0);
          }
        }
      });

      it(ownerOnly ? "denies an approved non-owner" : "scopes every data query to the caller", async () => {
        for (const [m, h] of await handlers(file)) {
          calls.length = 0;
          sessionRef.user = { id: FRIEND.id, email: FRIEND.email };
          const res = await call(h, m);
          if (ownerOnly) {
            expect(res?.status, `${m} as friend`).toBe(401);
            continue;
          }
          for (const c of dataCalls()) {
            const arg = c.args[0] as { where?: Record<string, unknown>; data?: Record<string, unknown> } | undefined;
            const scoped =
              arg?.where?.userId === FRIEND.id ||
              arg?.data?.userId === FRIEND.id ||
              // id-only lookups must be followed by a userId check elsewhere; flag them
              false;
            expect(scoped, `${m} ${c.model}.${c.method} not scoped to caller: ${JSON.stringify(arg)}`).toBe(true);
          }
        }
      });
    });
  }

  it("lets the owner through the guard", async () => {
    const file = routes.find((f) => f.endsWith("api/ideas/route.ts"))!;
    sessionRef.user = { id: OWNER.id, email: OWNER.email };
    const [, get] = (await handlers(file)).find(([m]) => m === "GET")!;
    const res = await call(get, "GET");
    expect(res?.status).not.toBe(401);
  });
});
