import { NextResponse } from "next/server";
import { requireUser, signState } from "@/lib/runs/http";

const NEXT_OK = /^(\/welcome|\/projects\/[A-Za-z0-9_-]+\/setup)$/;

// Connect GitHub. Default: GitHub sign-in (OAuth), which also works when the
// GitHub account already has the app installed (the install page would show
// "Configure" and never come back). `?fresh=1` goes straight to a new install,
// for another account or org. Either way we return to `next` afterwards.
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const slug = process.env.GITHUB_APP_SLUG;
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  if (!slug || !clientId) return NextResponse.json({ error: "GitHub App is not configured" }, { status: 503 });

  const u = new URL(request.url);
  const state = signState(auth.userId);
  const url = u.searchParams.get("fresh") === "1"
    ? `https://github.com/apps/${slug}/installations/new?state=${state}`
    : `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}`;
  const res = NextResponse.redirect(url);
  const next = u.searchParams.get("next");
  if (next && NEXT_OK.test(next)) {
    res.cookies.set("ihq_next", next, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  }
  return res;
}
