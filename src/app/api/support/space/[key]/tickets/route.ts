import { createTicket, loadPublicSpace, rateStore } from "@/lib/support/public-store";
import { firstExceeded, RULES, clientIp } from "@/lib/support/ratelimit";
import { verifyTurnstile } from "@/lib/support/turnstile";
import { validateSubmission } from "@/lib/support/form-schema";
import { hashIdent, verifyBlob } from "@/lib/support/tokens";
import { firstLine } from "@/lib/support/sanitize";
import { LIMITS } from "@/lib/support/constants";
import { customerReceiptEmail, ownerNewTicketEmail, sendEmail, ticketLink, baseUrl } from "@/lib/support/email";
import { json, readJson, sameOriginOk } from "@/lib/support/http";

// PUBLIC route (no login): a customer submits the support form.
export async function POST(request: Request, props: { params: Promise<{ key: string }> }) {
  const params = await props.params;
  if (!sameOriginOk(request)) return json({ error: "Forbidden" }, 403);
  const body = await readJson(request, 30_000);
  if (!body) return json({ error: "Invalid request" }, 400);
  const space = await loadPublicSpace(params.key);
  if (!space) return json({ error: "Support is not available" }, 404);

  const ip = clientIp(request.headers);
  const ipKey = hashIdent(ip);
  if (await firstExceeded(rateStore, [RULES.ticketIp(ipKey)])) return json({ error: "Too many requests" }, 429);

  // Honeypot: real people never see this field. Pretend it worked.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return json({ ok: true, number: 100 + Math.floor(Math.random() * 900) });
  }

  if (!(await verifyTurnstile(body.token, ip))) return json({ error: "Verification failed" }, 403);

  const checked = validateSubmission(space.form, { email: body.email, message: body.message, fields: body.fields });
  if (!checked.ok) return json({ errors: checked.errors }, 422);
  const sub = checked.value;

  if (await firstExceeded(rateStore, [RULES.ticketEmail(hashIdent(sub.email)), RULES.ticketProjectDay(space.projectId)])) {
    return json({ error: "Too many requests" }, 429);
  }

  // An AI answer is only attached if the server signed it for this space.
  let aiAnswer: { question: string; answer: string } | null = null;
  const signed = verifyBlob<{ q?: unknown; a?: unknown; k?: unknown }>(body.aiBlob);
  if (signed && signed.k === space.id && typeof signed.q === "string" && typeof signed.a === "string") {
    aiAnswer = { question: signed.q, answer: signed.a };
  }

  const subject = firstLine(aiAnswer?.question || sub.message, LIMITS.subjectMax) || "Support request";
  const { number, token } = await createTicket({
    space, email: sub.email, name: sub.name, subject, message: sub.message, fields: sub.fields, aiAnswer,
  });

  // Emails never block or fail the ticket.
  const receipt = customerReceiptEmail({ title: space.title, number, link: ticketLink(token), replyTime: space.replyTimeNote });
  const ownerTo = space.notifyEmail || space.ownerEmail;
  const notify = ownerTo
    ? ownerNewTicketEmail({ title: space.title, number, subject, snippet: sub.message.slice(0, 300), inboxLink: `${baseUrl()}/support` })
    : null;
  await Promise.allSettled([
    sendEmail({ to: sub.email, fromName: space.title, ...receipt }),
    notify && ownerTo ? sendEmail({ to: ownerTo, fromName: "Idea HQ", ...notify }) : Promise.resolve(false),
  ]);

  return json({ ok: true, number });
}
