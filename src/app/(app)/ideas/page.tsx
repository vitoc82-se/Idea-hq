import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { IdeasBoard } from "./ideas-board";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const session = await getServerSession(authOptions);

  if (!(await isOwner(session?.user?.id, session?.user?.email))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ideas</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          This backlog is private to the app owner.
        </p>
      </div>
    );
  }

  return <IdeasBoard />;
}
