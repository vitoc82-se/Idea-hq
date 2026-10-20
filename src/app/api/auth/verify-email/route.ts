import { NextResponse } from "next/server";
import { confirmEmail } from "@/lib/email-verification";
import { ipFrom, verifyBlocked } from "@/lib/auth-limits";

// PUBLIC (the signed link is the credential): confirm an email address. A POST, so a mail scanner that
// only opens links cannot confirm an address on someone's behalf.
export async function POST(request: Request) {
  if (await verifyBlocked(ipFrom(request.headers))) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const result = await confirmEmail(body?.token);
  if (result !== "ok") {
    return NextResponse.json({ error: "This link is not valid any more. Sign in and ask for a new one." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
