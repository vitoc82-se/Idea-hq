import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadChangelog } from "@/lib/changelog/public-store";
import { ENTRY_KIND_LABEL, type EntryKind } from "@/lib/changelog/kinds";

export const dynamic = "force-dynamic";

const monthOf = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayOf = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export async function generateMetadata(props: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const params = await props.params;
  const c = await loadChangelog(params.key);
  if (!c) return { title: "Page not found", robots: { index: false, follow: false } };
  const title = `What's new in ${c.name}`;
  const description = c.entries[0] ? `Latest: ${c.entries[0].title}. Every change we have shipped to ${c.name}, newest first.` : `Changes and fixes shipped to ${c.name}.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/changes/${params.key}` },
    openGraph: { type: "website", siteName: c.name, title, description, url: `/changes/${params.key}` },
    twitter: { card: "summary_large_image", title, description },
    manifest: null,
  };
}

// A project's public "What's new" page: only what the owner chose to publish.
export default async function ChangesPage(props: { params: Promise<{ key: string }> }) {
  const params = await props.params;
  const c = await loadChangelog(params.key);
  if (!c) notFound();

  const months: { label: string; items: typeof c.entries }[] = [];
  for (const e of c.entries) {
    const label = monthOf(e.publishedAt);
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(e);
    else months.push({ label, items: [e] });
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-slate-900 dark:text-gray-100">
      <main className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight [text-wrap:balance] sm:text-4xl">What&apos;s new in {c.name}</h1>
        <p className="mt-3 text-gray-700 dark:text-gray-300">The changes and fixes we have shipped, newest first.</p>

        {months.length === 0 ? (
          <p className="mt-10 rounded-xl border border-gray-300 p-6 text-gray-700 dark:border-gray-600 dark:text-gray-300">Nothing has been published yet. Check back soon.</p>
        ) : (
          months.map((m) => (
            <section key={m.label} aria-label={m.label} className="mt-10">
              <h2 className="border-b border-gray-300 pb-2 text-sm font-semibold uppercase tracking-wider text-gray-700 dark:border-gray-600 dark:text-gray-300">{m.label}</h2>
              <ol className="mt-4 space-y-6">
                {m.items.map((e) => (
                  <li key={e.id}>
                    <article>
                      <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <span className="rounded-full border border-gray-500 px-2 py-0.5 text-xs font-semibold text-gray-900 dark:border-gray-400 dark:text-gray-100">
                          {ENTRY_KIND_LABEL[e.kind as EntryKind] ?? "New"}
                        </span>
                        <time dateTime={e.publishedAt.toISOString()}>{dayOf(e.publishedAt)}</time>
                      </p>
                      <h3 className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">{e.title}</h3>
                      {e.body && <p className="mt-1 whitespace-pre-line leading-relaxed text-gray-800 [overflow-wrap:anywhere] dark:text-gray-200">{e.body}</p>}
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </main>
      <footer className="mx-auto max-w-2xl px-4 pb-10 text-sm text-gray-600 dark:text-gray-400">
        Powered by <a href="https://ideahq.cloud" className="underline">Idea HQ</a>
      </footer>
    </div>
  );
}
