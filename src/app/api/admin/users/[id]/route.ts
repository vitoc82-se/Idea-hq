import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { KNOWN_FEATURES } from "@/lib/support/constants";

// Owner-only: approve or revoke an account, and switch optional features (e.g. tickets) on or off.
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
  const hasApproved = body && typeof body.approved === "boolean";
  const hasFeatures = body && Array.isArray(body.features) && body.features.every((f: unknown) => typeof f === "string" && (KNOWN_FEATURES as readonly string[]).includes(f));
  if (!hasApproved && !hasFeatures) {
    return NextResponse.json({ error: "approved (boolean) or features (known names) required" }, { status: 400 });
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
    data: {
      ...(hasApproved ? { approved: body.approved } : {}),
      ...(hasFeatures ? { features: Array.from(new Set<string>(body.features)) } : {}),
    },
    select: { id: true, email: true, approved: true, features: true },
  });
  return NextResponse.json({ user });
}
