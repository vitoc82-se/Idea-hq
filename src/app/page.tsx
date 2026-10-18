import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: 1, title: "Write down an idea", text: "In plain words, like you would tell a friend. \"Add a dark mode.\" \"Show the version number in the footer.\"" },
  { n: 2, title: "The AI plans it", text: "It reads your project, estimates how big the idea is, and writes a plan you can read and change." },
  { n: 3, title: "The AI builds it", text: "It makes the change in a safe copy inside your GitHub project, and tests it. Nothing goes live yet." },
  { n: 4, title: "You check and approve", text: "You look at what changed. If you like it, one click puts it live. If not, ask for changes or throw it away." },
];

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  // Signed-in people go straight to their ideas; everyone else sees what this is.
  if (session) redirect("/ideas");

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100">
      <SiteHeader signedIn={false} />
      <main className="max-w-3xl mx-auto px-4">
        <section className="pt-14 pb-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Turn your ideas into working changes, without writing the code.</h1>
          <p className="mt-5 text-lg text-gray-600 dark:text-gray-300">
            Idea HQ is one place for the ideas behind all your projects. Write an idea in plain words. An AI plans it, builds it in your own GitHub project, and tests it. You look at the result and decide if it goes live.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/auth/signin?mode=register" className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">Create an account</Link>
            <Link href="/guide" className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 font-medium hover:border-emerald-600">Read the guide</Link>
          </div>
          <p className="mt-3 text-sm text-gray-500">New accounts are approved by the owner before you can start.</p>
        </section>

        <section className="py-8">
          <h2 className="text-2xl font-semibold">How it works</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <span className="inline-flex w-7 h-7 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-medium">{s.n}</span>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="py-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">Made for people who build with AI</h2>
            <p className="mt-3 text-gray-600 dark:text-gray-300">
              You do not need to know the technical side. The setup is a guided checklist, and the guide explains every word in plain language.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-semibold">You stay in control</h2>
            <p className="mt-3 text-gray-600 dark:text-gray-300">
              Every change arrives as a proposal you can read. The AI works in your own GitHub project with your own key, and it cannot put anything live without your approval.
            </p>
          </div>
        </section>

        <section className="py-8">
          <h2 className="text-2xl font-semibold">What you need</h2>
          <ul className="mt-4 space-y-2 text-gray-700 dark:text-gray-200 list-disc pl-5">
            <li>A free GitHub account, with your project&apos;s code on it.</li>
            <li>An Anthropic account for the AI (you pay Anthropic directly for what you use, usually cents per small change).</li>
            <li>About 10 minutes for the first setup.</li>
          </ul>
          <p className="mt-4"><Link href="/guide" className="text-emerald-600 hover:underline">Read the full guide →</Link></p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
