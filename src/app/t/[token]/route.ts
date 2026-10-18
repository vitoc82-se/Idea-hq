import { loadTicketByToken } from "@/lib/support/public-store";
import { renderTicketPage } from "@/lib/support/ticket-page";
import { notFoundPage } from "@/lib/support/page-shell";

// PUBLIC page: a customer's private ticket page. The link token is the credential.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const t = await loadTicketByToken(params.token);
  if (!t) {
    const nf = notFoundPage("This link is not valid or the ticket no longer exists.");
    return new Response(nf.html, { status: 404, headers: nf.headers });
  }
  const { html, headers } = renderTicketPage(t, params.token);
  return new Response(html, { headers });
}
