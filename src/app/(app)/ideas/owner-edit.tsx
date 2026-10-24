"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// Hands-on control of what the AI wrote about an idea: change the scope or the build prompt by hand, and tell the AI what
// it got wrong. `onSave` answers with an error message, or null when it worked.

export function EditBox({ label, initial, rows = 8, onSave, onCancel }: { label: string; initial: string; rows?: number; onSave: (text: string) => Promise<string | null>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Textarea aria-label={label} value={text} onChange={(e) => setText(e.target.value)} rows={rows} className="text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const problem = await onSave(text);
            setBusy(false);
            if (problem) setError(problem);
          }}
        >
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Save
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <span className="text-xs text-gray-600 dark:text-gray-400">Saving an empty text removes it, and the AI can write a new one.</span>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

// "What's wrong with this?": the owner's corrections, kept on the idea and given to the AI every time it estimates, splits
// or plans it. `again` runs the step the owner wants repeated once the corrections are saved.
export function CorrectionsBox({ id, saved, onSave, again }: { id: string; saved: string; onSave: (text: string) => Promise<string | null>; again: { label: string; run: () => Promise<void> } }) {
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState<"save" | "again" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (what: "save" | "again") => {
    setBusy(what);
    setMessage(null);
    const problem = await onSave(text);
    if (problem) {
      setMessage({ ok: false, text: problem });
      setBusy(null);
      return;
    }
    if (what === "again") await again.run();
    setBusy(null);
    setMessage({ ok: true, text: text.trim() ? "Saved. The AI gets this every time it works on this idea." : "Cleared." });
  };
  return (
    <div className="mt-4 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700" data-testid="corrections">
      <Label htmlFor={id} className="text-sm font-medium">What&apos;s wrong with this?</Label>
      <p className="text-xs text-gray-600 dark:text-gray-400">Say what the AI got wrong or missed, in plain words. It follows this over its own guess, and gets it every time it estimates, splits or plans this idea.</p>
      <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={3} className="text-sm" placeholder="e.g. The settings screen for this already exists. A ticket waiting for the customer has the status pending." />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy !== null || !text.trim()} onClick={() => run("again")}>
          {busy === "again" ? <Loader2 className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{again.label}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null || text.trim() === saved.trim()} onClick={() => run("save")}>
          {busy === "save" ? <Loader2 className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Save only
        </Button>
        {saved.trim() && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={async () => { setText(""); setBusy("save"); const p = await onSave(""); setBusy(null); setMessage(p ? { ok: false, text: p } : { ok: true, text: "Cleared." }); }}>Clear</Button>}
      </div>
      <p role="status" className={`text-xs ${message && !message.ok ? "text-red-700 dark:text-red-400" : "text-gray-600 dark:text-gray-400"}`}>{message?.text ?? ""}</p>
    </div>
  );
}
