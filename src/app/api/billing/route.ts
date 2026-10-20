import { NextResponse } from "next/server";
import { requireUser } from "@/lib/runs/http";
import { billingStatus } from "@/lib/billing";

export const dynamic = "force-dynamic";

// The signed-in person's plan, credits and checkout links.
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const status = await billingStatus(auth.userId);
  if (!status) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.json(status);
}
