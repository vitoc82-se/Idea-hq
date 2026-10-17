import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userCanSeeInstallation } from "@/lib/github/client";
import { requireUser, verifyState } from "@/lib/runs/http";

// GitHub redirects here after install ("Setup URL"). The app must have "Request
// user authorization (OAuth) during installation" on, so we get a `code` that
// proves the person can actually see this installation.
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const u = new URL(request.url);
  const installationId = Number(u.searchParams.get("installation_id"));
  const code = u.searchParams.get("code");
  const cookieNext = /ihq_next=([^;]+)/.exec(request.headers.get("cookie") || "")?.[1];
  const dest = cookieNext && /^\/projects\/[A-Za-z0-9_-]+\/setup$/.test(decodeURIComponent(cookieNext)) ? decodeURIComponent(cookieNext) : "/projects";
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`${dest}?github=${q}`, request.url));
    res.cookies.delete("ihq_next");
    return res;
  };

  if (!verifyState(u.searchParams.get("state"), auth.userId)) return back("bad_state");
  if (!Number.isInteger(installationId) || installationId <= 0 || !code) return back("missing");
  if (!(await userCanSeeInstallation(code, installationId))) return back("not_yours");

  await db.githubInstallation.upsert({
    where: { userId_id: { userId: auth.userId, id: installationId } },
    create: { userId: auth.userId, id: installationId },
    update: {},
  });
  return back("connected");
}
