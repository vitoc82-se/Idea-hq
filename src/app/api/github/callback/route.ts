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
  const back = (q: string) => NextResponse.redirect(new URL(`/projects?github=${q}`, request.url));

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
