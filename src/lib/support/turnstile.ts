// Cloudflare Turnstile verification (server side). Fails closed: with no secret
// configured, nothing passes in production.
export async function verifyTurnstile(token: unknown, ip: string | null, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return process.env.NODE_ENV !== "production" && process.env.SUPPORT_TURNSTILE_BYPASS === "1";
  }
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export function turnstileSiteKey(): string {
  return process.env.TURNSTILE_SITE_KEY || "";
}
