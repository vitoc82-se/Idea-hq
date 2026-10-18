import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { relayProviderKey } from "@/lib/provider-keys";

export const dynamic = "force-dynamic";

// Paste a provider key once; it is checked, written to the chosen repos as an
// Actions secret, and forgotten. Nothing about the key is stored or logged, and
// the response never contains it.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const noStore = { "Cache-Control": "no-store" };
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400, headers: noStore });
    const out = await relayProviderKey(auth.userId, params.id, { provider: body.provider, key: body.key, alsoProjectIds: body.alsoProjectIds });
    return NextResponse.json(out, { headers: noStore });
  } catch (e) {
    const res = errorResponse(e);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}
