import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

// Idea HQ is a private single-user tool — no marketing page. Send people
// straight to the board (signed in) or the sign-in screen (signed out).
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  redirect(session ? "/ideas" : "/auth/signin");
}
