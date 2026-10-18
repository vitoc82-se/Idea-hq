import { addCustomerMessage, loadTicketByToken, rateStore } from "@/lib/support/public-store";
import { firstExceeded, RULES, clientIp } from "@/lib/support/ratelimit";
import { hashIdent, hashToken, isTokenShape } from "@/lib/support/tokens";
import { cleanText } from "@/lib/support/sanitize";
import { LIMITS } from "@/lib/support/constants";
import { baseUrl, ownerNewTicketEmail, sendEmail } from "@/lib/support/email";
import { json, readJson, sameOriginOk } from "@/lib/support/http";

// PUBLIC routes (no login; the private link token is the credential).
export async function GET(request: Request, { params }: { params: { token: string } }) {
  if (!isTokenShape(params.token)) return json({ error: "Not found" }, 404);
  const ipKey = hashIdent(clientIp(request.headers));
  if (await firstExceeded(rateStore, [RULES.readIp(ipKey)])) return json({ error: "Too many requests" }, 429);
  const t = await loadTicketByToken(params.token);
  if (!t) return json({ error: "Not found" }, 404);
  return json({ number: t.number, status: t.status, subject: t.subject, title: t.space.title, messages: t.messages });
}

export async function POST(request: Request, { params }: { params: { token: string } }) {
  if (!sameOriginOk(request)) return json({ error: "Forbidden" }, 403);
  if (!isTokenShape(params.token)) return json({ error: "Not found" }, 404);
  const body = await readJson(request, 12_000);
  if (!body) return json({ error: "Invalid request" }, 400);

  const ipKey = hashIdent(clientIp(request.headers));
  if (await firstExceeded(rateStore, [RULES.replyIp(ipKey), RULES.replyToken(hashToken(params.token))])) {
    return json({ error: "Too many requests" }, 429);
  }
  const t = await loadTicketByToken(params.token);
  if (!t) return json({ error: "Not found" }, 404);
  if (t.status === "closed") return json({ error: "This ticket is closed" }, 409);

  const text = cleanText(body.body, LIMITS.replyMax + 1);
  if (!text) return json({ error: "Write a reply" }, 422);
  if (text.length > LIMITS.replyMax) return json({ error: `Keep it under ${LIMITS.replyMax} characters` }, 422);

  const ok = await addCustomerMessage(t.id, text);
  if (!ok) return json({ error: "This ticket is closed" }, 409);

  const to = t.space.notifyEmail || t.space.ownerEmail;
  if (to) {
    const mail = ownerNewTicketEmail({
      title: t.space.title, number: t.number, subject: t.subject, snippet: text.slice(0, 300),
      inboxLink: `${baseUrl()}/support`, customerReply: true,
    });
    await sendEmail({ to, fromName: "Idea HQ", ...mail });
  }
  return json({ ok: true });
}
