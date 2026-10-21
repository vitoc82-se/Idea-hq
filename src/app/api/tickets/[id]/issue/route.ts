import { NextResponse } from "next/server";
import { requireTickets } from "@/lib/support/owner";
import { IssueError, createIssueFromTicket, draftFromTicket, linkCandidates, linkTicket, unlinkTicket } from "@/lib/issues";

function fail(e: unknown) {
  if (e instanceof IssueError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("ticket issue route error", (e as Error)?.name);
  return NextResponse.json({ error: "Could not do that just now. Try again in a moment." }, { status: 500 });
}

// Owner: what a ticket would become (a pre-filled draft) and which open bugs or ideas it could join.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  try {
    const [draft, candidates] = await Promise.all([draftFromTicket(auth.userId, params.id), linkCandidates(auth.userId, params.id)]);
    return NextResponse.json({ draft, candidates });
  } catch (e) {
    return fail(e);
  }
}

// Owner: turn the ticket into a new bug or idea, add it to an existing one, or unlink it.
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send what you want to do." }, { status: 400 });
  try {
    if (body.action === "create") return NextResponse.json({ idea: await createIssueFromTicket(auth.userId, params.id, body) }, { status: 201 });
    if (body.action === "link") return NextResponse.json({ idea: await linkTicket(auth.userId, params.id, body.ideaId) });
    if (body.action === "unlink") {
      await unlinkTicket(auth.userId, params.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action must be create, link or unlink." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
