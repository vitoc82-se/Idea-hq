import { headerSafe } from "./sanitize";
import { CUSTOMER_STATUS_LABEL, type TicketStatus } from "./constants";

// Send-only email through Resend. Never throws: a failed send is reported as
// false and the ticket stays saved. Only the status code is logged, never text.

export function baseUrl(): string {
  return (process.env.SUPPORT_BASE_URL || "https://ideahq.cloud").replace(/\/+$/, "");
}

export function ticketLink(token: string): string {
  return `${baseUrl()}/t/${token}`;
}

function fromAddress(displayName: string): string | null {
  const addr = process.env.SUPPORT_FROM_EMAIL?.trim();
  if (!addr || !/^[^\s<>"]+@[^\s<>"]+$/.test(addr)) return null;
  const name = headerSafe(displayName, 60).replace(/["<>\\]/g, "");
  return name ? `${name} <${addr}>` : addr;
}

export async function sendEmail(
  opts: { to: string; subject: string; text: string; fromName: string; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = fromAddress(opts.fromName);
  if (!key || !from) return false;
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [headerSafe(opts.to, 254)], subject: headerSafe(opts.subject, 200), text: opts.text }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
    });
    if (!res.ok) console.error("support email failed", res.status);
    return res.ok;
  } catch {
    console.error("support email failed (network)");
    return false;
  }
}

const SPAM_NOTE = "Replies to this email are not read. Please use the link above to answer.";

export function customerReceiptEmail(p: { title: string; number: number; link: string; replyTime?: string | null }) {
  return {
    subject: `We got your message (#${p.number})`,
    text: [
      `Thanks for contacting ${p.title}. We got your message and it is ticket #${p.number}.`,
      p.replyTime ? p.replyTime : "",
      "",
      "Follow this ticket and reply here (this link is private, keep it to yourself):",
      p.link,
      "",
      SPAM_NOTE,
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
  };
}

export function customerReplyEmail(p: { title: string; number: number; link: string; body: string; status: TicketStatus }) {
  return {
    subject: `Reply to your message (#${p.number})`,
    text: [
      `${p.title} replied to your ticket #${p.number}:`,
      "",
      p.body,
      "",
      `Status: ${CUSTOMER_STATUS_LABEL[p.status]}`,
      "Read the whole conversation and answer here (this link is private):",
      p.link,
      "",
      SPAM_NOTE,
    ].join("\n"),
  };
}

export function ownerNewTicketEmail(p: { title: string; number: number; subject: string; snippet: string; inboxLink: string; customerReply?: boolean }) {
  return {
    subject: `${p.customerReply ? "New reply on" : "New ticket"} #${p.number} (${p.title}): ${headerSafe(p.subject, 80)}`,
    text: [`${p.customerReply ? "A customer replied" : "A new ticket came in"} for ${p.title}.`, "", p.snippet, "", `Open it: ${p.inboxLink}`].join("\n"),
  };
}
