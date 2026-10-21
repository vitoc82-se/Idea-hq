"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PUBLIC_REPO_NOTICE } from "@/lib/runs/public-safe";

type Linked = { id: string; title: string; kind: string; status: string } | null;
type Candidate = { id: string; title: string; kind: string; status: string };
type Mode = null | "bug" | "idea" | "link";

const field = "mt-1.5 w-full";

// On a support ticket: turn it into a bug or idea on the board, or add it to one that
// already exists (several customers often report the same problem).
export function IssuePanel({ ticketId, linked, onChanged }: { ticketId: string; linked: Linked; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; kind: string } | null>(null);
  const [draft, setDraft] = useState({ title: "", notes: "", repro: "", severity: "medium" });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pick, setPick] = useState("");
  const [publicRepo, setPublicRepo] = useState<{ open: boolean; removed: boolean }>({ open: false, removed: false });

  const begin = async (m: Exclude<Mode, null>) => {
    setMode(m);
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/issue`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not open this.");
      setDraft({ title: d.draft.title, notes: d.draft.notes, repro: "", severity: "medium" });
      setPublicRepo({ open: !!d.draft.repoPublic, removed: !!d.draft.personalDetailsRemoved });
      setCandidates(d.candidates);
      setPick(d.candidates[0]?.id ?? "");
    } catch (e) {
      setError((e as Error).message || "Could not reach Idea HQ. Check your connection and try again.");
      setMode(null);
    } finally {
      setBusy(false);
    }
  };

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tickets/${ticketId}/issue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "That did not work. Try again in a moment.");
        return;
      }
      if (d.idea) setDone({ id: d.idea.id, kind: d.idea.kind });
      setMode(null);
      onChanged();
    } catch {
      setError("Could not reach Idea HQ. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (linked) {
    return (
      <div className="mt-4 rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-600">
        <p className="text-gray-900 dark:text-white">
          Linked to {linked.kind === "bug" ? "bug" : "idea"}{" "}
          <Link href={`/ideas/${linked.id}`} className="font-semibold underline">{linked.title}</Link>{" "}
          <span className="text-gray-600 dark:text-gray-400">({linked.status === "done" ? "done" : "open"})</span>
        </p>
        <Button variant="ghost" size="sm" className="mt-1" disabled={busy} onClick={() => send({ action: "unlink" })}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Unlink
        </Button>
        {error && <p role="alert" className="mt-1 text-red-700 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-600">
      <p className="font-semibold text-gray-900 dark:text-white">Track this</p>
      {done && (
        <p role="status" className="mt-1 text-emerald-800 dark:text-emerald-300">
          Added. <Link href={`/ideas/${done.id}`} className="font-semibold underline">Open the {done.kind === "bug" ? "bug" : "idea"}</Link>
        </p>
      )}
      {mode === null && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => begin("bug")} disabled={busy}>Turn into a bug</Button>
          <Button variant="outline" size="sm" onClick={() => begin("idea")} disabled={busy}>Turn into an idea</Button>
          <Button variant="outline" size="sm" onClick={() => begin("link")} disabled={busy}>Add to an existing one</Button>
        </div>
      )}

      {(mode === "bug" || mode === "idea") && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send({ action: "create", kind: mode, title: draft.title, notes: draft.notes, repro: draft.repro, severity: draft.severity });
          }}
        >
          <div>
            <Label htmlFor="issue-title">Title</Label>
            <Input id="issue-title" className={field} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} required />
          </div>
          <div>
            <Label htmlFor="issue-notes">{mode === "bug" ? "What happens and what should happen" : "Notes"}</Label>
            <Textarea id="issue-notes" className={`${field} min-h-[120px]`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Pre-filled from the customer. Read it and remove anything you do not want the AI to see.</p>
            {publicRepo.open && (
              <p role="note" className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                {PUBLIC_REPO_NOTICE}
                {publicRepo.removed ? " Some details were removed from this draft." : ""}
              </p>
            )}
          </div>
          {mode === "bug" && (
            <>
              <div>
                <Label htmlFor="issue-repro">Steps to reproduce (the more exact, the better the fix)</Label>
                <Textarea id="issue-repro" className={field} value={draft.repro} onChange={(e) => setDraft({ ...draft, repro: e.target.value })} placeholder={"1. Open the login page\n2. Press Sign in\n3. Nothing happens"} />
              </div>
              <div>
                <Label htmlFor="issue-sev">How bad is it?</Label>
                <Select id="issue-sev" className="mt-1.5 w-full sm:w-56" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
                  <option value="low">Minor</option>
                  <option value="medium">Normal</option>
                  <option value="high">Serious</option>
                </Select>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" disabled={busy || !draft.title.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create {mode === "bug" ? "bug" : "idea"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setMode(null)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}

      {mode === "link" && (
        <div className="mt-3 space-y-2">
          {busy ? (
            <p className="text-gray-700 dark:text-gray-300">Loading…</p>
          ) : candidates.length === 0 ? (
            <p className="text-gray-700 dark:text-gray-300">There is no open bug or idea in this project yet. Turn this ticket into a new one instead.</p>
          ) : (
            <>
              <Label htmlFor="issue-pick">Add this ticket to</Label>
              <Select id="issue-pick" className="w-full" value={pick} onChange={(e) => setPick(e.target.value)}>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.kind === "bug" ? "Bug: " : ""}{c.title}</option>)}
              </Select>
              <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy || !pick} onClick={() => send({ action: "link", ideaId: pick })}>Add to it</Button>
            </>
          )}
          <Button variant="outline" onClick={() => setMode(null)} disabled={busy}>Cancel</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
