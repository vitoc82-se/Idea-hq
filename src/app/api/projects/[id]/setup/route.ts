import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { openSetupPr } from "@/lib/runs/engine";

// Opens the one-time setup PR that adds the Idea HQ workflow to the repo.
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) return NextResponse.json({ error: "GitHub App is not configured" }, { status: 503 });
  try {
    const pr = await openSetupPr(auth.userId, params.id, slug);
    return NextResponse.json({ prNumber: pr.number });
  } catch (e) {
    return errorResponse(e);
  }
}
