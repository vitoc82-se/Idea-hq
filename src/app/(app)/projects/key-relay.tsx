"use client";

import { useState } from "react";
import { Loader2, Check, X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Provider = { id: string; label: string; secretName: string; keyHelpUrl: string; keyHelpText: string };
type Sibling = { id: string; name: string; repo: string; provider: string };
type Result = { projectId: string; repo: string; ok: boolean; message: string };

// Paste an API key once. Idea HQ checks it, writes it into the chosen repos as an
// Actions secret, and forgets it. The key is never stored.
export function KeyRelay({ projectId, provider, siblings, onDone }: { projectId: string; provider: Provider; siblings: Sibling[]; onDone?: () => void }) {
  const [key, setKey] = useState("");
  const [also, setAlso] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  const send = async () => {
    setBusy(true); setError(null); setResults(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/provider-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, key, alsoProjectIds: siblings.filter((s) => also[s.id]).map((s) => s.id) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || "Could not save the key. Try again in a moment."); return; }
      setResults(j.results);
      setKey(""); // never keep it on screen
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <p className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Add your {provider.label.split(" ")[0]} key for me</p>
      <p className="text-xs text-gray-500">
        Paste it once. Idea HQ checks that it works, saves it in your repo as a secret named <code>{provider.secretName}</code>, and forgets it. It is not stored here. You need {provider.keyHelpText}.{" "}
        <a href={provider.keyHelpUrl} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">Create a key</a>
      </p>
      <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={`Your ${provider.label.split(" ")[0]} API key`} />
      {siblings.filter((s) => s.provider === provider.id).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500">Also add it to your other projects that use {provider.label.split(" ")[0]}:</p>
          {siblings.filter((s) => s.provider === provider.id).map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!also[s.id]} onChange={(e) => setAlso({ ...also, [s.id]: e.target.checked })} />
              {s.name} <span className="text-xs text-gray-400">{s.repo}</span>
            </label>
          ))}
        </div>
      )}
      <Button size="sm" onClick={send} disabled={busy || !key.trim()}>
        {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Check and save the key
      </Button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {results && (
        <ul className="space-y-1">
          {results.map((r) => (
            <li key={r.projectId} className="text-sm flex items-start gap-1.5">
              {r.ok ? <Check className="w-4 h-4 text-emerald-600 mt-0.5" /> : <X className="w-4 h-4 text-red-500 mt-0.5" />}
              <span><b>{r.repo}</b>: {r.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
