import { NextResponse } from "next/server";
import { requireTickets } from "@/lib/support/owner";
import { IssueError, notifyCustomers, reportsFor } from "@/lib/issues";

function fail(e: unknown) {
  if (e instanceof IssueError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("idea reports route error", (e as Error)?.name);
  return NextResponse.json({ error: "Could not do that just now. Try again in a moment." }, { status: 500 });
}

// Owner: the support tickets that reported this bug or idea, and whether the customers can be told it shipped.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  try {
    return NextResponse.json(await reportsFor(auth.userId, params.id));
  } catch (e) {
    return fail(e);
  }
}

// Owner: tell those customers it shipped. Once per idea.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await notifyCustomers(auth.userId, params.id, body?.message));
  } catch (e) {
    return fail(e);
  }
}
