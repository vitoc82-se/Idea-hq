// Rate-limit rules for the public routes. Counters live in the RateBucket table
// (shared across serverless instances); keys only hold hashed identifiers.

export type RateStore = { hit(key: string, windowSec: number): Promise<number> };

export type Rule = { key: string; limit: number; windowSec: number };

export const RULES = {
  askIp: (ip: string) => ({ key: `ask:ip:${ip}`, limit: 12, windowSec: 3600 }),
  ticketIp: (ip: string) => ({ key: `ticket:ip:${ip}`, limit: 6, windowSec: 3600 }),
  ticketEmail: (email: string) => ({ key: `ticket:email:${email}`, limit: 4, windowSec: 3600 }),
  // The receipt goes to whatever address was typed, so one address gets only a few a day, from any number of support forms.
  receiptEmailDay: (email: string) => ({ key: `receipt:email:${email}`, limit: 3, windowSec: 86400 }),
  ticketProjectDay: (projectId: string) => ({ key: `ticket:proj:${projectId}`, limit: 200, windowSec: 86400 }),
  replyIp: (ip: string) => ({ key: `reply:ip:${ip}`, limit: 20, windowSec: 3600 }),
  replyToken: (tokenHash: string) => ({ key: `reply:tok:${tokenHash.slice(0, 24)}`, limit: 20, windowSec: 3600 }),
  readIp: (ip: string) => ({ key: `read:ip:${ip}`, limit: 120, windowSec: 600 }),
  aiProjectDay: (projectId: string, cap: number) => ({ key: `ai:proj:${projectId}`, limit: cap, windowSec: 86400 }),
};

// Returns the first rule that is over its limit, or null when all pass.
export async function firstExceeded(store: RateStore, rules: Rule[]): Promise<Rule | null> {
  for (const r of rules) {
    const n = await store.hit(r.key, r.windowSec);
    if (n > r.limit) return r;
  }
  return null;
}

// The caller's address as seen by Vercel's edge. Falls back to a constant so a
// missing header still rate-limits (shared bucket) instead of skipping limits.
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip") || "unknown";
}
