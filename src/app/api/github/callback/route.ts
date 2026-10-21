import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userInstallations } from "@/lib/github/client";
import { requireUser, verifyState, signState } from "@/lib/runs/http";

const NEXT_OK = /^(\/welcome|\/projects\/[A-Za-z0-9_-]+\/setup)$/;

// GitHub sends the user here after either (a) signing in with GitHub (code only)
// or (b) installing the app (code + installation_id). Both prove which
// installations this person can see; we store those for their Idea HQ account.
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const installationId = Number(u.searchParams.get("installation_id"));

  const cookieNext = /ihq_next=([^;]+)/.exec(request.headers.get("cookie") || "")?.[1];
  const decoded = cookieNext ? decodeURIComponent(cookieNext) : "";
  const dest = NEXT_OK.test(decoded) ? decoded : "/projects";
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`${dest}?github=${q}`, request.url));
    res.cookies.delete("ihq_next");
    return res;
  };

  if (!verifyState(u.searchParams.get("state"), auth.userId)) return back("bad_state");
  if (!code) return back("missing");

  const mine = await userInstallations(code);
  if (!mine) return back("failed");

  // Claimed installation from a fresh install must be one they can see.
  const wanted = Number.isInteger(installationId) && installationId > 0 ? [installationId] : mine.map((x) => x.id);
  const ids = wanted.filter((id) => mine.some((x) => x.id === id));
  if (wanted.length && ids.length === 0) return back("not_yours");

  if (ids.length === 0) {
    // Signed in, but the app is not installed anywhere they can see: install it.
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) return back("failed");
    return NextResponse.redirect(`https://github.com/apps/${slug}/installations/new?state=${signState(auth.userId)}`);
  }

  for (const id of ids) {
    // Reconnecting refreshes which repos this person may use through the installation (when GitHub says).
    const repos = mine.find((x) => x.id === id)?.repos;
    const known = Array.isArray(repos) ? { repos, reposCheckedAt: new Date() } : {};
    await db.githubInstallation.upsert({
      where: { userId_id: { userId: auth.userId, id } },
      create: { userId: auth.userId, id, ...known },
      update: known,
    });
  }
  return back("connected");
}
