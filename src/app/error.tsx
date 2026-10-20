"use client";

import Link from "next/link";

// Shown when a page fails while it is loading. The rest of the app keeps working.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-20">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">This page could not load</h1>
      <p className="mt-4 text-lg leading-relaxed text-gray-700 dark:text-gray-300">
        Something failed on our side while opening it. What you saved is safe. Try again, and if it keeps failing, tell the owner
        {error.digest ? <> and mention this code: <code className="rounded bg-gray-100 px-1.5 py-0.5 text-base dark:bg-gray-800">{error.digest}</code></> : null}.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-emerald-700 px-6 text-base font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        >
          Try again
        </button>
        <Link href="/ideas" className="inline-flex min-h-[48px] items-center rounded-xl px-3 text-base font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900 dark:text-emerald-300">
          Go to my ideas
        </Link>
      </div>
    </main>
  );
}
