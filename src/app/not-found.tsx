import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

// Shown for any address that does not exist. The page itself answers with a 404 status.
export default function NotFound() {
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-slate-900 dark:text-gray-100">
      <SiteHeader signedIn={false} />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
        <p className="text-sm font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">Error 404</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight [text-wrap:balance]">We could not find that page</h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-gray-700 dark:text-gray-300">
          The address may have a typo, or the page may have moved. Your ideas and projects are not affected.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href="/ideas" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-emerald-700 px-6 text-base font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">
            Go to my ideas
          </Link>
          <Link href="/" className="inline-flex min-h-[48px] items-center rounded-xl px-3 text-base font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900 dark:text-emerald-300">
            Back to the start page
          </Link>
          <Link href="/guide" className="inline-flex min-h-[48px] items-center rounded-xl px-3 text-base font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900 dark:text-emerald-300">
            Read the guide
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
