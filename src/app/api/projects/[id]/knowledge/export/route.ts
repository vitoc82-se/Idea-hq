import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { exportKnowledgeToRepo } from "@/lib/knowledge-export";

// Opens a pull request that saves the knowledge into the repo.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const r = await exportKnowledgeToRepo(auth.userId, params.id);
    return NextResponse.json({ prNumber: r.number, reused: r.reused });
  } catch (e) {
    return errorResponse(e);
  }
}
