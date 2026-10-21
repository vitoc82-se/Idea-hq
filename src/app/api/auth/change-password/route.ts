import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { changePasswordBlocked, ipFrom } from "@/lib/auth-limits";

// bcrypt only reads the first 72 bytes; anything longer adds nothing and costs time.
const PASSWORD_MAX_BYTES = 72;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  // Guessing the current password through this form is a way round the sign-in limits, so it has its own.
  if (await changePasswordBlocked(session.user.id, ipFrom(request.headers))) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;

  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Current and new password are required" },
      { status: 400 }
    );
  }
  if (currentPassword.length > 200) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }
  if (Buffer.byteLength(newPassword, "utf8") > PASSWORD_MAX_BYTES) {
    return NextResponse.json({ error: "Password must be at most 72 characters" }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "New password must differ from the current one" },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  });
  if (!user?.password || !(await bcrypt.compare(currentPassword, user.password))) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 403 }
    );
  }

  // A new password signs the person out everywhere (including a stolen session), so they sign in again.
  await db.user.update({
    where: { id: session.user.id },
    data: {
      password: await bcrypt.hash(newPassword, 12),
      mustChangePassword: false,
      sessionVersion: { increment: 1 },
    },
  });

  return NextResponse.json({ message: "Password changed", signedOut: true });
}
