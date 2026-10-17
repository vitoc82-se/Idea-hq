import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";
import { avatarError } from "@/lib/avatar";

export async function PATCH(request: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const image = body?.image;
  const error = image === undefined ? "image is required" : avatarError(image);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const user = await db.user.update({
      where: { id: userId },
      data: { image },
      select: { image: true },
    });
    return NextResponse.json({ image: user.image });
  } catch (error) {
    console.error("Update profile error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
