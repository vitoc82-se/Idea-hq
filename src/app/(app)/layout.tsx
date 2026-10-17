import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isOwner } from "@/lib/owner";
import { needsWelcome } from "@/lib/onboarding";
import { Navbar } from "@/components/navbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true, approved: true, onboardingDismissed: true },
  });
  if (me?.mustChangePassword) {
    redirect("/auth/change-password");
  }

  // New and unapproved users start in the welcome journey.
  const owner = await isOwner(session.user.id, session.user.email);
  const projectCount = await db.project.count({ where: { userId: session.user.id } });
  if (needsWelcome({ approved: !!me?.approved, owner, projectCount, dismissed: !!me?.onboardingDismissed })) {
    redirect("/welcome");
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <Navbar />
      <main className="lg:pl-64 pt-14 lg:pt-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
