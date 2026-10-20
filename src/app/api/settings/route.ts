import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/runs/http";

export const dynamic = "force-dynamic";

// The signed-in person's own preferences.
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const me = await db.user.findUnique({ where: { id: auth.userId }, select: { email: true, notifyEmail: true } });
  if (!me) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.json({ email: me.email, notifyEmail: me.notifyEmail });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "notifyEmail")) {
    return NextResponse.json({ error: "Send only the setting you want to change." }, { status: 400 });
  }
  if (typeof (body as { notifyEmail?: unknown }).notifyEmail !== "boolean") {
    return NextResponse.json({ error: "notifyEmail must be true or false." }, { status: 400 });
  }
  const me = await db.user.update({ where: { id: auth.userId }, data: { notifyEmail: (body as { notifyEmail: boolean }).notifyEmail }, select: { email: true, notifyEmail: true } });
  return NextResponse.json({ email: me.email, notifyEmail: me.notifyEmail });
}
