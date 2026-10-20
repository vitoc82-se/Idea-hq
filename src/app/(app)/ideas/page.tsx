import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { IdeasBoard } from "./ideas-board";

export const metadata = { title: "Ideas" };

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const session = await getServerSession(authOptions);

  if (!(await canUse(session?.user?.id, session?.user?.email))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ideas</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          Your account is waiting for approval. Ask Niklas to approve you.
        </p>
      </div>
    );
  }

  return <IdeasBoard />;
}
