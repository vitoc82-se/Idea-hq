"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/notice";
import { ENTRY_KIND_LABEL, ENTRY_KINDS } from "@/lib/changelog/kinds";

type Entry = { id: string; kind: string; title: string; body: string | null; publishedAt: string | null; createdAt: string; fromChange: boolean };

export function ChangesSettings({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const base = `/api/projects/${projectId}/changes`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const d = await res.json();
      setEnabled(d.enabled);
      setUrl(d.url);
      setEntries(d.entries);
    } catch {
      setNotice("Could not load the page settings. Reload to try again.");
    }
  }, [base]);
  useEffect(() => {
    load();
  }, [load]);

  const call = async (path: string, method: string, body?: unknown): Promise<boolean> => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setNotice(d.error || "That did not work. Try again in a moment.");
        return false;
      }
      await load();
      return true;
    } catch {
      setNotice("Could not reach Idea HQ. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const drafts = (entries ?? []).filter((e) => !e.publishedAt);
  const published = (entries ?? []).filter((e) => e.publishedAt);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/projects" className="text-sm text-emerald-700 hover:underline">← Back to projects</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">What&apos;s new page</h1>
        <p className="text-sm text-gray-700 dark:text-gray-300">A public page where the people who use {projectName} can see what you shipped. Only entries you publish appear on it.</p>
      </div>
      <Notice text={notice} onClose={() => setNotice("")} />

      <section aria-labelledby="live-h" className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
        <h2 id="live-h" className="font-semibold text-gray-900 dark:text-white">The page</h2>
        <label className="mt-2 flex min-h-[44px] items-center gap-3 text-sm text-gray-900 dark:text-white">
          <input type="checkbox" className="h-5 w-5" checked={enabled} disabled={busy || entries === null} onChange={(e) => call(base, "PATCH", { enabled: e.target.checked })} />
          Show a public What&apos;s new page
        </label>
        {enabled && url && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <a href={url} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-emerald-800 underline dark:text-emerald-300">{url}</a>
            <Button variant="outline" size="sm" onClick={copy}>{copied ? "Copied" : "Copy the address"}</Button>
          </div>
        )}
        {!enabled && url && <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">The page is off. Its address stays the same when you turn it back on.</p>}
      </section>

      <NewEntry busy={busy} onCreate={(body) => call(`${base}/entries`, "POST", body)} />

      {entries === null ? (
        <div aria-busy="true" aria-label="Loading entries" className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
      ) : (
        <>
          <EntryList
            title="Drafts"
            empty="No drafts. When a change is merged, a draft appears here for you to word and publish."
            entries={drafts}
            busy={busy}
            onSave={(id, body) => call(`${base}/entries/${id}`, "PATCH", body)}
            onDelete={(id) => call(`${base}/entries/${id}`, "DELETE")}
          />
          <EntryList
            title="Published"
            empty="Nothing published yet."
            entries={published}
            busy={busy}
            onSave={(id, body) => call(`${base}/entries/${id}`, "PATCH", body)}
            onDelete={(id) => call(`${base}/entries/${id}`, "DELETE")}
          />
        </>
      )}
    </div>
  );
}

function NewEntry({ busy, onCreate }: { busy: boolean; onCreate: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", body: "", kind: "new" });
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Write an entry by hand</Button>;
  return (
    <form
      className="space-y-3 rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onCreate({ title: f.title, body: f.body, kind: f.kind, published: true })) {
          setF({ title: "", body: "", kind: "new" });
          setOpen(false);
        }
      }}
    >
      <p className="text-sm text-gray-700 dark:text-gray-300">For a change that did not go through Idea HQ. It is published right away.</p>
      <div>
        <Label htmlFor="new-title">Title</Label>
        <Input id="new-title" className="mt-1.5" value={f.title} maxLength={120} required onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="new-body">Details (optional)</Label>
        <Textarea id="new-body" className="mt-1.5" value={f.body} maxLength={1500} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="new-kind">Type</Label>
        <Select id="new-kind" className="mt-1.5 w-full sm:w-48" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {ENTRY_KINDS.map((k) => <option key={k} value={k}>{ENTRY_KIND_LABEL[k]}</option>)}
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" disabled={busy || !f.title.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Publish</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

function EntryList({ title, empty, entries, busy, onSave, onDelete }: {
  title: string; empty: string; entries: Entry[]; busy: boolean;
  onSave: (id: string, body: Record<string, unknown>) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title} ({entries.length})</h2>
      {entries.length === 0 && <p className="text-sm text-gray-700 dark:text-gray-300">{empty}</p>}
      {entries.map((e) => <EntryRow key={e.id} entry={e} busy={busy} onSave={onSave} onDelete={onDelete} />)}
    </section>
  );
}

function EntryRow({ entry, busy, onSave, onDelete }: { entry: Entry; busy: boolean; onSave: (id: string, b: Record<string, unknown>) => Promise<boolean>; onDelete: (id: string) => Promise<boolean> }) {
  const [f, setF] = useState({ title: entry.title, body: entry.body ?? "", kind: entry.kind });
  const [confirming, setConfirming] = useState(false);
  const live = !!entry.publishedAt;
  const dirty = f.title !== entry.title || f.body !== (entry.body ?? "") || f.kind !== entry.kind;
  return (
    <div className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
      <div className="space-y-3">
        <div>
          <Label htmlFor={`t-${entry.id}`}>Title</Label>
          <Input id={`t-${entry.id}`} className="mt-1.5" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`b-${entry.id}`}>Details (optional)</Label>
          <Textarea id={`b-${entry.id}`} className="mt-1.5" value={f.body} maxLength={1500} onChange={(e) => setF({ ...f, body: e.target.value })} />
          {entry.fromChange && !live && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">This title came from your idea. Reword it for the people who use your product before you publish.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`k-${entry.id}`} className="sr-only">Type</Label>
          <Select id={`k-${entry.id}`} className="w-40" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {ENTRY_KINDS.map((k) => <option key={k} value={k}>{ENTRY_KIND_LABEL[k]}</option>)}
          </Select>
          {dirty && <Button variant="outline" size="sm" disabled={busy || !f.title.trim()} onClick={() => onSave(entry.id, { title: f.title, body: f.body, kind: f.kind })}>Save changes</Button>}
          {live ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onSave(entry.id, { published: false })}>Unpublish</Button>
          ) : (
            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={busy || !f.title.trim()} onClick={async () => { if (!dirty || (await onSave(entry.id, { title: f.title, body: f.body, kind: f.kind }))) await onSave(entry.id, { published: true }); }}>
              Publish
            </Button>
          )}
          {confirming ? (
            <>
              <Button size="sm" className="bg-red-700 hover:bg-red-800" disabled={busy} onClick={() => onDelete(entry.id)}>Yes, delete it</Button>
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Keep it</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setConfirming(true)}>Delete</Button>
          )}
          {live && <span className="text-xs text-gray-600 dark:text-gray-400">Live since {new Date(entry.publishedAt!).toLocaleDateString()}</span>}
        </div>
      </div>
    </div>
  );
}
