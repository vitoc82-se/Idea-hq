import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { authOptions } from "@/lib/auth";
import { SiteFooter } from "@/components/site-chrome";
import { Rocket } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Idea HQ: write down ideas, review the finished changes" },
  description:
    "Write your ideas down. Idea HQ plans each one, an AI builds it inside your own GitHub project, and you approve the result before anything changes.",
  alternates: { canonical: "/" },
};

const STEPS = [
  ["Write", "One line is enough. The AI sizes the idea and drafts a plan you can edit."],
  ["Approve", "It builds on a separate branch in your repo, with your own key. Nothing merges by itself."],
  ["Merge", "Review it, ask for tweaks, ship it. Undo it later with one button."],
] as const;

const primary =
  "inline-flex min-h-[48px] items-center justify-center rounded-xl bg-emerald-400 px-6 text-base font-bold text-[#04281D] hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1310]";
const quiet =
  "inline-flex min-h-[48px] items-center justify-center rounded-xl px-3 text-base font-medium text-emerald-300 underline underline-offset-4 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300";
const label = "text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  // Signed-in people go straight to their ideas; everyone else gets the front door.
  if (session) redirect("/ideas");

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-slate-900 dark:text-gray-100">
      <header className="bg-[#0B1310] text-[#E6EFEA]">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400">
              <Rocket className="h-[18px] w-[18px] text-[#04281D]" aria-hidden="true" />
            </span>
            <span className="text-[17px] font-bold">Idea HQ</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-[15px] sm:gap-2">
            <Link href="/guide" className="hidden min-h-[44px] items-center px-3 text-[#B7C7BF] hover:text-white min-[420px]:inline-flex">Guide</Link>
            <Link href="/auth/signin" className="inline-flex min-h-[44px] items-center px-3 text-[#B7C7BF] hover:text-white">Sign in</Link>
            <Link href="/auth/signin?mode=register" className="inline-flex min-h-[44px] items-center rounded-[10px] bg-emerald-400 px-4 font-semibold text-[#04281D] hover:bg-emerald-300">Create account</Link>
          </nav>
        </div>
      </header>

      <main>
        <div className="bg-[#0B1310] pb-16 text-[#E6EFEA] sm:pb-24">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-12 px-4 pt-6 sm:pt-12">
          <section className="min-w-0 flex-[1_1_480px]">
            <h1 className="text-[clamp(2.75rem,7.2vw,5rem)] font-extrabold leading-[0.98] tracking-[-0.035em] [text-wrap:balance]">
              Ideas in. Reviewed changes out.
            </h1>
            <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-[#B7C7BF] sm:text-xl [text-wrap:pretty]">
              Write your ideas down. Idea HQ plans each one, an AI builds it inside your own GitHub project, and you approve the result before anything changes.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Link href="/auth/signin?mode=register" className={primary}>Create account</Link>
              <Link href="/auth/signin" className={quiet}>Sign in</Link>
            </div>
            <p className="mt-4 text-sm text-[#9DB1A8]">Invite-only for now. The owner approves new accounts before you can start.</p>
          </section>

          {/* An example of a finished change, drawn in plain HTML so it stays sharp and needs no image. */}
          <div
            role="img"
            aria-label="Example: a finished change to add a dark mode switch, showing the lines added and removed, with Merge and Request changes buttons"
            className="min-w-0 flex-[1_1_400px] overflow-hidden rounded-[14px] border border-[#28403A] bg-[#101C18]"
          >
            <div aria-hidden="true">
              <div className="flex items-center justify-between gap-3 border-b border-[#28403A] px-4 py-3.5">
                <p className="text-sm font-semibold">Add a dark mode switch to settings</p>
                <span className="shrink-0 rounded-full bg-emerald-400 px-2.5 py-1 text-xs font-semibold text-[#04281D]">Ready for review</span>
              </div>
              <div className="overflow-x-auto py-3.5 font-mono text-[13px] leading-[1.7]">
                <div className="min-w-max">
                  <p className="px-4 text-[#9DB1A8]">settings/theme.ts</p>
                  <p className="px-4">&nbsp;</p>
                  <p className="bg-[#3A1D22] px-4 text-[#FFC9CF]">- const theme = &quot;light&quot;;</p>
                  <p className="bg-[#123628] px-4 text-[#B5F3D6]">+ const theme = loadTheme() ?? &quot;system&quot;;</p>
                  <p className="bg-[#123628] px-4 text-[#B5F3D6]">+ export function setTheme(next: Theme) {"{"}</p>
                  <p className="bg-[#123628] px-4 text-[#B5F3D6]">+   localStorage.setItem(&quot;theme&quot;, next);</p>
                  <p className="bg-[#123628] px-4 text-[#B5F3D6]">+ {"}"}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#28403A] px-4 py-3.5">
                <p className="text-[13px] text-[#B7C7BF]">4 files changed · all checks passed</p>
                <div className="flex gap-2">
                  <span className="rounded-lg border border-[#4A6A60] px-3 py-2 text-[13px] font-semibold">Request changes</span>
                  <span className="rounded-lg bg-emerald-400 px-3.5 py-2 text-[13px] font-bold text-[#04281D]">Merge</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>

      <section aria-labelledby="board-h" className="mx-auto max-w-6xl px-4 pt-16 sm:pt-[72px]">
        <h2 id="board-h" className="max-w-2xl text-3xl font-bold tracking-[-0.025em] sm:text-4xl [text-wrap:balance]">
          Every idea in one place. What needs you is easy to spot.
        </h2>

        <div
          role="img"
          aria-label="Example ideas board with three columns: New, Planned and Waiting for you"
          className="mt-8 rounded-2xl border border-[#C3CFCA] bg-[#F3F7F5] p-4 dark:border-gray-600 dark:bg-slate-800 sm:p-5"
        >
          <div aria-hidden="true">
            <div className="flex items-center justify-between gap-3 px-1 pb-4">
              <p className="text-[15px] font-semibold">My project · Ideas</p>
              <p className="text-[13px] text-gray-700 dark:text-gray-300">Example board</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-3">
                <p className={label}>New</p>
                <div className="rounded-[10px] border border-[#D5DEDA] bg-white p-3.5 dark:border-gray-600 dark:bg-slate-900">
                  <p className="text-[15px] font-semibold">Show the cost of each run</p>
                  <p className="mt-2 text-[13px] text-gray-700 dark:text-gray-300">Not estimated yet</p>
                </div>
                <div className="rounded-[10px] border border-[#D5DEDA] bg-white p-3.5 dark:border-gray-600 dark:bg-slate-900">
                  <p className="text-[15px] font-semibold">Let people sort ideas by size</p>
                  <p className="mt-2 text-[13px] text-gray-700 dark:text-gray-300">Not estimated yet</p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <p className={label}>Planned</p>
                <div className="rounded-[10px] border border-[#D5DEDA] bg-white p-3.5 dark:border-gray-600 dark:bg-slate-900">
                  <p className="text-[15px] font-semibold">Let people import a TODO list</p>
                  <p className="mt-2 text-[13px] text-gray-700 dark:text-gray-300">Size: small · plan ready</p>
                  <span className="mt-3 inline-block rounded-lg bg-emerald-700 px-3 py-2 text-[13px] font-semibold text-white">Build it</span>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <p className={label}>Waiting for you</p>
                <div className="rounded-[10px] border border-emerald-700 bg-white p-3.5 dark:bg-slate-900">
                  <p className="text-[15px] font-semibold">Estimate all imported ideas</p>
                  <p className="mt-2 text-[13px] text-gray-800 dark:text-gray-200">Pull request ready · all checks passed</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-lg bg-emerald-700 px-3 py-2 text-[13px] font-semibold text-white">Merge</span>
                    <span className="rounded-lg border border-gray-500 px-3 py-2 text-[13px] font-semibold dark:border-gray-400">Request changes</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <ol className="mt-12 grid border-t border-[#D5DEDA] dark:border-gray-700 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className={`pt-7 sm:pt-7 ${i === 0 ? "sm:pr-7" : i === 1 ? "sm:border-l sm:border-[#D5DEDA] sm:px-7 dark:sm:border-gray-700" : "sm:border-l sm:border-[#D5DEDA] sm:pl-7 dark:sm:border-gray-700"}`}>
              <h3 className="text-[28px] font-bold tracking-[-0.02em]">{title}</h3>
              <p className="mt-2 leading-relaxed text-gray-800 dark:text-gray-300">{text}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href="/auth/signin?mode=register" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-emerald-700 px-6 text-base font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900">Create account</Link>
          <Link href="/guide" className="inline-flex min-h-[48px] items-center rounded-xl px-3 text-base font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200">Read the guide</Link>
        </div>
      </section>
      </main>

      <SiteFooter wide />
    </div>
  );
}
