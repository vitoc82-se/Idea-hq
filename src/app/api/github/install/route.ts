import { NextResponse } from "next/server";
import { requireUser, signState } from "@/lib/runs/http";

// Sends the signed-in user to install the Idea HQ GitHub App.
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) return NextResponse.json({ error: "GitHub App is not configured" }, { status: 503 });
  const url = `https://github.com/apps/${slug}/installations/new?state=${signState(auth.userId)}`;
  const res = NextResponse.redirect(url);
  // Come back to the setup guide afterwards (only our own project paths).
  const next = new URL(request.url).searchParams.get("next");
  if (next && /^\/projects\/[A-Za-z0-9_-]+\/setup$/.test(next)) {
    res.cookies.set("ihq_next", next, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  }
  return res;
}
