import crypto from "crypto";

// GitHub signs each delivery with HMAC-SHA256 of the raw body using the
// webhook secret, sent as `X-Hub-Signature-256: sha256=<hex>`.
export function verifyWebhookSignature(
  secret: string | undefined,
  rawBody: string,
  header: string | null | undefined
): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
