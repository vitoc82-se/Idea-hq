import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const dynamic = "force-dynamic";

const STEPS = [
  ["Write the idea", "One line is enough. The AI estimates the size and drafts a plan you can edit."],
  ["Approve and build", "The AI works inside your own GitHub project, on a separate branch, with your own API key."],
  ["Review and merge", "Read the change, ask for tweaks, merge it, or undo it later with one button."],
] as const;

const CONTROL = [
  ["Your project, your key", "The work happens in your GitHub. Idea HQ never keeps your API key."],
  ["Nothing merges by itself", "Every change waits for your approval. Auto-merge is off unless you turn it on."],
  ["Easy to undo", "A merged change can be reverted with one button, as a new change you approve."],
] as const;

const primary =
  "inline-flex min-h-[48px] items-center justify-center rounded-xl bg-emerald-700 px-6 text-base font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const quiet =
  "inline-flex min-h-[48px] items-center justify-center rounded-xl px-4 text-base font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  // Signed-in people go straight to their ideas; everyone else gets the front door.
  if (session) redirect("/ideas");

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100">
      <SiteHeader signedIn={false} wide />
      <main className="max-w-5xl mx-auto px-4">
        <section className="grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:py-24">
          <div>
            <h1 className="text-4xl font-bold tracking-[-0.02em] sm:text-5xl [text-wrap:balance]">
              Write down an idea. Review the finished change.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-700 dark:text-gray-300 [text-wrap:pretty]">
              Idea HQ plans each idea, then an AI builds it inside your own GitHub project and sends it to you for approval. Nothing changes until you say yes.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-2">
              <Link href="/auth/signin?mode=register" className={primary}>Create account</Link>
              <Link href="/auth/signin" className={quiet}>Sign in</Link>
            </div>
            <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">
              Invite-only for now: the owner approves new accounts before you can start.
            </p>
          </div>

          {/* An example of the flow, drawn in plain HTML so it is always sharp and works in dark mode. */}
          <div role="img" aria-label="Example: the idea 'Add a dark mode switch' becomes a three-step plan, then a finished change waiting for your approval" className="rounded-2xl border border-gray-300 bg-gray-50 p-4 dark:border-gray-600 dark:bg-slate-800 sm:p-5">
            <ol aria-hidden="true" className="space-y-3 text-sm">
              <li className="rounded-lg border border-gray-300 bg-white p-3 dark:border-gray-600 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">Your idea</p>
                <p className="mt-1 font-medium text-gray-900 dark:text-white">Add a dark mode switch to settings</p>
                <p className="mt-1 text-gray-700 dark:text-gray-300">Size: medium</p>
              </li>
              <li className="rounded-lg border border-gray-300 bg-white p-3 dark:border-gray-600 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">The plan</p>
                <p className="mt-1 text-gray-900 dark:text-white">1. Add a theme toggle<br />2. Remember the choice<br />3. Update the colours</p>
              </li>
              <li className="rounded-lg border border-emerald-700 bg-white p-3 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">The change</p>
                <p className="mt-1 text-gray-900 dark:text-white">Ready for review. All checks passed.</p>
                <span className="mt-2 inline-block rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Merge</span>
              </li>
            </ol>
          </div>
        </section>

        <section aria-labelledby="how-h" className="border-t border-gray-200 py-12 dark:border-gray-800 sm:py-16">
          <h2 id="how-h" className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Step {i + 1}</span>
                <h3 className="mt-1 text-lg font-semibold">{title}</h3>
                <p className="mt-2 leading-relaxed text-gray-700 dark:text-gray-300">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="control-h" className="border-t border-gray-200 py-12 dark:border-gray-800 sm:py-16">
          <h2 id="control-h" className="text-2xl font-semibold tracking-tight">You stay in control</h2>
          <dl className="mt-8 grid gap-8 sm:grid-cols-3">
            {CONTROL.map(([title, text]) => (
              <div key={title}>
                <dt className="text-lg font-semibold">{title}</dt>
                <dd className="mt-2 leading-relaxed text-gray-700 dark:text-gray-300">{text}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-2">
            <Link href="/auth/signin?mode=register" className={primary}>Create account</Link>
            <Link href="/guide" className={quiet}>Read the guide</Link>
          </div>
        </section>
      </main>
      <SiteFooter wide />
    </div>
  );
}
