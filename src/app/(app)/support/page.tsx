import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { hasTickets } from "@/lib/support/owner";
import { Inbox } from "./inbox";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return <p className="text-gray-500 dark:text-gray-400">Your account is waiting for approval.</p>;
  }
  if (!(await hasTickets(userId, session?.user?.email ?? null))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Support</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Support tickets are not switched on for your account yet. Ask the owner of Idea HQ to turn them on.</p>
      </div>
    );
  }
  return <Inbox />;
}
