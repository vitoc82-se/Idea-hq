import { vi } from "vitest";
import fs from "fs";
import path from "path";

export const OWNER = { id: "u-owner", email: "owner@x.se", approved: true, mustChangePassword: false };
export const FRIEND = { id: "u-friend", email: "friend@x.se", approved: true, mustChangePassword: false };
export const OTHER = { id: "u-other", email: "other@x.se", approved: true, mustChangePassword: false };
export const UNAPPROVED = { id: "u-new", email: "new@x.se", approved: false, mustChangePassword: false };
export const MUSTCHANGE = { id: "u-must", email: "must@x.se", approved: true, mustChangePassword: true };
export const USERS = [OWNER, FRIEND, OTHER, UNAPPROVED, MUSTCHANGE];

export type Call = { model: string; method: string; args: unknown[] };
export const calls: Call[] = [];
export const override: { userFindUnique?: (where: { id?: string }) => unknown } = {};
export const sessionRef: { user: { id: string; email: string } | null } = { user: null };

// Recording stand-in for the Prisma client: every model method is a spy that
// returns an empty result, except the `user` lookups the access layer needs.
export function makeDb() {
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) =>
        vi.fn(async (...args: unknown[]) => {
          calls.push({ model: name, method, args });
          if (name === "user" && method === "findUnique") {
            const where = (args[0] as { where: { id?: string } }).where;
            if (override.userFindUnique) return override.userFindUnique(where);
            const u = USERS.find((x) => x.id === where.id);
            return u ? { ...u, aiCallsDay: null, aiCallsToday: 0 } : null;
          }
          if (name === "user" && method === "findFirst") return { id: OWNER.id };
          if (method === "findMany") return [];
          if (method === "count") return 0;
          if (method === "$transaction") return null;
          return null;
        }),
    });
  const cache: Record<string, unknown> = {};
  return new Proxy({}, {
    get: (_t, name: string) => {
      if (name === "$transaction") {
        return vi.fn(async (fn: unknown) => (typeof fn === "function" ? fn(makeDbProxy()) : fn));
      }
      return (cache[name] ??= model(name));
    },
  });
}
let dbProxy: unknown;
export function makeDbProxy() {
  return (dbProxy ??= makeDb());
}

export function routeFiles(root = path.resolve(__dirname, "../src/app/api")): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") out.push(p);
    }
  };
  walk(root);
  return out;
}

export function jsonRequest(method: string) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
}
