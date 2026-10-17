import { NextResponse } from "next/server";
import { requireUser, signState } from "@/lib/runs/http";

// Sends the signed-in user to install the Idea HQ GitHub App.
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) return NextResponse.json({ error: "GitHub App is not configured" }, { status: 503 });
  const url = `https://github.com/apps/${slug}/installations/new?state=${signState(auth.userId)}`;
  void request;
  return NextResponse.redirect(url);
}
