import { clientIp, firstExceeded, type Rule } from "./support/ratelimit";
import { rateStore } from "./support/public-store";
import { hashIdent } from "./support/tokens";

// Brakes on the sign-in and sign-up routes (they are public, and each attempt costs a slow password
// hash). Counters live in the shared database table, so they hold across server instances.
//
// A person is never locked out by someone else's guessing: the tight limit is per address AND
// per sign-in email together; the wide ones (per address, per email) only stop real floods.

export const AUTH_RULES = {
  loginPair: (ip: string, email: string): Rule => ({ key: `login:pair:${hashIdent(`${ip}|${email}`)}`, limit: 8, windowSec: 900 }),
  loginIp: (ip: string): Rule => ({ key: `login:ip:${hashIdent(ip)}`, limit: 40, windowSec: 900 }),
  loginEmail: (email: string): Rule => ({ key: `login:email:${hashIdent(email)}`, limit: 100, windowSec: 3600 }),
  registerIp: (ip: string): Rule => ({ key: `register:ip:${hashIdent(ip)}`, limit: 5, windowSec: 3600 }),
  registerEmail: (email: string): Rule => ({ key: `register:email:${hashIdent(email)}`, limit: 3, windowSec: 3600 }),
  verifyIp: (ip: string): Rule => ({ key: `verify:ip:${hashIdent(ip)}`, limit: 20, windowSec: 3600 }),
  resendUser: (userId: string): Rule => ({ key: `resend:user:${hashIdent(userId)}`, limit: 3, windowSec: 3600 }),
};

export const TOO_MANY_LOGINS = "TOO_MANY_ATTEMPTS";

type HeaderBag = Headers | Record<string, string | string[] | undefined> | undefined | null;

// next-auth hands the sign-in code a plain object of headers; routes have a Headers.
export function ipFrom(headers: HeaderBag): string {
  if (!headers) return clientIp(new Headers());
  if (headers instanceof Headers) return clientIp(headers);
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) if (typeof v === "string") h.set(k, v);
  return clientIp(h);
}

export async function loginBlocked(ip: string, email: string): Promise<boolean> {
  return !!(await firstExceeded(rateStore, [AUTH_RULES.loginPair(ip, email), AUTH_RULES.loginIp(ip), AUTH_RULES.loginEmail(email)]));
}

export async function registerBlocked(ip: string, email: string): Promise<boolean> {
  return !!(await firstExceeded(rateStore, [AUTH_RULES.registerIp(ip), AUTH_RULES.registerEmail(email)]));
}

export async function verifyBlocked(ip: string): Promise<boolean> {
  return !!(await firstExceeded(rateStore, [AUTH_RULES.verifyIp(ip)]));
}

export async function resendBlocked(userId: string): Promise<boolean> {
  return !!(await firstExceeded(rateStore, [AUTH_RULES.resendUser(userId)]));
}
