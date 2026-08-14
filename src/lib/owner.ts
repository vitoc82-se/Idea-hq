import { db } from "./db";

// Access control for owner-only surfaces (e.g. the Ideas backlog).
//
// Priority:
//   1. If OWNER_EMAIL is set (Vercel → Settings → Environment Variables),
//      only that account is the owner.
//   2. Otherwise the owner is the FIRST-registered account (the app creator).
//      This locks owner-only surfaces to you out of the box, with no config —
//      other signed-in users are denied.
export async function isOwner(
  userId: string | null | undefined,
  email: string | null | undefined
): Promise<boolean> {
  if (!userId) return false;

  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (owner) {
    return !!email && email.trim().toLowerCase() === owner;
  }

  const first = await db.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return !!first && first.id === userId;
}
