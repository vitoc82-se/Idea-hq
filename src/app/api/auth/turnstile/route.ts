import { NextResponse } from "next/server";
import { turnstileSiteKey } from "@/lib/support/turnstile";

// PUBLIC: the (public) site key the sign-up form needs to show the "are you a person" check.
export async function GET() {
  const off = process.env.REGISTER_CAPTCHA === "off";
  return NextResponse.json({ siteKey: off ? "" : turnstileSiteKey() }, { headers: { "Cache-Control": "no-store" } });
}
