import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";

// Owner-only: approve or revoke an account.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.approved !== "boolean") {
    return NextResponse.json({ error: "approved (boolean) required" }, { status: 400 });
  }
  const target = await db.user.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const user = await db.user.update({
    where: { id: params.id },
    data: { approved: body.approved },
    select: { id: true, email: true, approved: true },
  });
  return NextResponse.json({ user });
}
