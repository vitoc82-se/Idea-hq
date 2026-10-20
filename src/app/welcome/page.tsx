import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Welcome } from "./welcome";

export const metadata = { title: "Welcome", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");
  const me = await db.user.findUnique({ where: { id: session.user.id }, select: { mustChangePassword: true, name: true } });
  if (me?.mustChangePassword) redirect("/auth/change-password");
  return <Welcome name={me?.name || session.user.name || ""} />;
}
