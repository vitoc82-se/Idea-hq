import { NextResponse } from "next/server";
import { applyBillingEvent, verifySignature } from "@/lib/billing-webhook";

// Lemon Squeezy -> Idea HQ. Public by design, protected by the signature. Nothing
// from the payload is logged (it holds customer details).
export async function POST(request: Request) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "";
  if (!secret) return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });

  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  try {
    const out = await applyBillingEvent(payload);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error("billing webhook failed", (e as Error).name);
    return NextResponse.json({ error: "Could not apply the event." }, { status: 500 });
  }
}
