import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { exportAccount } from "@/lib/account-data";
import { exportBlocked } from "@/lib/auth-limits";

export const dynamic = "force-dynamic";

// Any signed-in person (approved or not) can download everything held about their account.
export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (await exportBlocked(userId)) return NextResponse.json({ error: "You downloaded your data several times just now. Try again in an hour." }, { status: 429 });
  const data = await exportAccount(userId);
  if (!data) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="idea-hq-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
