import { db } from "./db";

// Access control for owner-only surfaces (the Admin panel, support tickets, billing overrides).
//
// Who is the owner:
//   1. If OWNER_EMAIL is set (Vercel → Settings → Environment Variables), the OLDEST account
//      that holds exactly that address (letters may differ in case, nothing else).
//   2. Otherwise the FIRST-registered account (the app creator).
//
// Matching on the address alone is not safe: anyone can register "OWNER@x.se" or " owner@x.se"
// as a separate account. So the owner is a specific account (the oldest holder of the address),
// never "whoever shows this address". A lookalike created later can never be the owner.
export async function ownerUserId(): Promise<string | null> {
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (owner) {
    const first = await db.user.findFirst({ where: { email: { equals: owner, mode: "insensitive" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    return first?.id ?? null;
  }
  const first = await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return first?.id ?? null;
}

// What to call the owner in messages to other people ("Ask Ann to approve you"): the first name on the owner's account.
export async function ownerDisplayName(): Promise<string> {
  const id = await ownerUserId();
  if (!id) return "the owner";
  const u = await db.user.findUnique({ where: { id }, select: { name: true } });
  const first = (u?.name || "").trim().split(/\s+/)[0];
  return first ? first.slice(0, 40) : "the owner";
}

export async function isOwner(
  userId: string | null | undefined,
  email: string | null | undefined
): Promise<boolean> {
  if (!userId) return false;

  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  // Cheap first look at the address the session carries; the account check below is what decides.
  if (owner && (!email || email.trim().toLowerCase() !== owner)) return false;
  return (await ownerUserId()) === userId;
}
