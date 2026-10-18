import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Rocket } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  // Signed-in people go straight to their ideas; everyone else gets the front door.
  if (session) redirect("/ideas");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-600 mb-5">
          <Rocket className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Idea HQ</h1>
        <p className="mt-3 text-gray-600 dark:text-gray-300">
          Write down your ideas. An AI builds them into your project, and you approve each change.
        </p>

        <Link
          href="/auth/signin?mode=register"
          className="mt-8 block w-full px-6 py-3.5 rounded-xl bg-emerald-600 text-white text-lg font-semibold hover:bg-emerald-700"
        >
          Create account
        </Link>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
          Already have one?{" "}
          <Link href="/auth/signin" className="text-emerald-600 font-medium hover:underline">Sign in</Link>
        </p>

        <p className="mt-10 text-xs text-gray-500 dark:text-gray-400">
          Private for now: new accounts are approved by the owner before you can start.{" "}
          <Link href="/guide" className="underline hover:text-emerald-600">How it works</Link>
        </p>
      </div>
    </main>
  );
}
