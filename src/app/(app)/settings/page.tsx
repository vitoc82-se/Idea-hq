import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { db } from "@/lib/db";
import { ProfilePicture } from "./profile-picture";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  if (!(await canUse(session?.user?.id, session?.user?.email))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          This workspace is private to the app owner.
        </p>
      </div>
    );
  }

  const user = await db.user.findUnique({
    where: { id: session!.user.id },
    select: { image: true, name: true, email: true },
  });

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <ProfilePicture image={user?.image} name={user?.name} email={user?.email} />
    </div>
  );
}
