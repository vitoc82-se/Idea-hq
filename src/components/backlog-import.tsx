"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type Item = { title: string; notes: string; done: boolean; pick: boolean };

// Bring an existing backlog into a project: a TODO file in the repo, or pasted
// text. The AI lists the ideas it finds; the owner ticks what to import.
export function BacklogImport({ projectId, onImported, onSkip }: { projectId: string; onImported?: (created: number) => void; onSkip?: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [source, setSource] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/import`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d) => {
        setFiles(d.files ?? []);
        setRepo(d.repoConnected ? d.repo : null);
      })
      .catch(() => setFiles([]));
  }, [projectId]);

  const preview = async (body: { path?: string; text?: string }) => {
    setBusy(body.path ?? "text");
    setMsg(null);
    const res = await fetch(`/api/projects/${projectId}/import/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Could not read that." });
    setSource(d.source);
    setItems((d.items as Omit<Item, "pick">[]).map((i) => ({ ...i, pick: !i.done })));
    if (d.truncated) setMsg({ ok: true, text: "That was a long list, so only the first part was read. Import these, then run it again with the rest." });
  };

  const commit = async () => {
    if (!items) return;
    const chosen = items.filter((i) => i.pick);
    setBusy("commit");
    const res = await fetch(`/api/projects/${projectId}/import`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, items: chosen.map(({ title, notes, done }) => ({ title, notes, done })) }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Could not import." });
    setResult(d);
    setItems(null);
    onImported?.(d.created);
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 400_000) return setMsg({ ok: false, text: "That file is too big. Paste the part you want instead." });
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ""));
    r.readAsText(f);
  };

  if (result) {
    return (
      <div role="status" className="space-y-2 text-sm text-gray-800 dark:text-gray-200">
        <p><b>{result.created}</b> idea{result.created === 1 ? "" : "s"} imported{result.skipped ? `, ${result.skipped} skipped because you already had them` : ""}. On the Ideas page, press <b>Estimate them all</b> to have the AI size them.</p>
        <Button size="sm" variant="outline" onClick={() => { setResult(null); setText(""); setMsg(null); }}>Import another list</Button>
      </div>
    );
  }

  if (items) {
    const n = items.filter((i) => i.pick).length;
    const set = (idx: number, patch: Partial<Item>) => setItems(items.map((it, k) => (k === idx ? { ...it, ...patch } : it)));
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">The AI found {items.length} ideas in <b>{source}</b>. Untick anything you do not want, and fix titles if needed. Items that look finished are unticked.</p>
        <div className="flex gap-3 text-sm">
          <button type="button" className="text-emerald-700 underline dark:text-emerald-400" onClick={() => setItems(items.map((i) => ({ ...i, pick: true })))}>Select all</button>
          <button type="button" className="text-emerald-700 underline dark:text-emerald-400" onClick={() => setItems(items.map((i) => ({ ...i, pick: false })))}>Select none</button>
        </div>
        <ul className="max-h-96 space-y-2 overflow-auto rounded-lg border border-gray-300 p-2 dark:border-gray-600">
          {items.map((it, i) => (
            <li key={i} className="flex gap-3 rounded-md p-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <input type="checkbox" className="mt-2 h-5 w-5 shrink-0" checked={it.pick} onChange={(e) => set(i, { pick: e.target.checked })} aria-label={`Import ${it.title}`} />
              <div className="min-w-0 flex-1 space-y-1">
                <Input value={it.title} maxLength={100} onChange={(e) => set(i, { title: e.target.value })} aria-label="Title" />
                {it.notes && <p className="text-xs text-gray-600 dark:text-gray-400">{it.notes}</p>}
                {it.done && <span className="inline-block rounded-full border border-gray-400 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300">Looks finished (imported as done)</span>}
              </div>
            </li>
          ))}
        </ul>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-gray-700 dark:text-gray-300" : "text-red-700 dark:text-red-400"}`}>{msg.text}</p>}
        <div className="flex gap-2">
          <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={commit} disabled={n === 0 || busy !== null}>
            {busy === "commit" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Import {n} idea{n === 1 ? "" : "s"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setItems(null)} disabled={busy !== null}>Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {files === null ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">Looking in your repo…</p>
      ) : files.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-800 dark:text-gray-200">We found {files.length === 1 ? "a file" : "files"} in {repo} that look like a backlog:</p>
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f}>
                <Button size="sm" variant="outline" onClick={() => preview({ path: f })} disabled={busy !== null}>
                  {busy === f ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}Read {f}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-gray-700 dark:text-gray-300">{repo ? `We did not find a TODO or backlog file in ${repo}.` : "Connect your repo and we can look for a TODO file there."} You can paste your list instead.</p>
      )}

      <div className="space-y-2">
        <label htmlFor="bl-text" className="block text-sm font-medium text-gray-900 dark:text-white">Or paste your list, or upload a file</label>
        <p className="text-xs text-gray-600 dark:text-gray-400">From a TODO.md, Notion, Trello, Apple Notes, an email to yourself, anywhere. Any format works.</p>
        <Textarea id="bl-text" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[120px] text-sm" placeholder={"- [ ] Dark mode\n- [ ] Export to PDF\n- [x] Login page"} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => preview({ text })} disabled={text.trim().length < 3 || busy !== null}>
            {busy === "text" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Find the ideas
          </Button>
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt,.csv,.rst,text/plain,text/markdown,text/csv" className="sr-only" aria-label="Upload a backlog file" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" />Upload a file</Button>
          {onSkip && <Button size="sm" variant="ghost" onClick={onSkip}>No, I will start fresh</Button>}
        </div>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-gray-700 dark:text-gray-300" : "text-red-700 dark:text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
