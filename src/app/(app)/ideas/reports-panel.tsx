"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Reports = {
  tickets: { id: string; number: number; subject: string; customerName: string | null; status: string }[];
  canNotify: boolean;
  reachable: number;
  notifiedAt: string | null;
  defaultMessage: string;
};

// On a bug or idea: the support tickets that asked for it, and a one-time "tell them it shipped".
// Hidden when the account has no support tickets at all.
export function ReportsPanel({ ideaId, status }: { ideaId: string; status: string }) {
  const [data, setData] = useState<Reports | null>(null);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ideas/${ideaId}/reports`, { cache: "no-store" });
      if (!res.ok) return;
      const d: Reports = await res.json();
      setData(d);
      setMessage((m) => m || d.defaultMessage);
    } catch {
      /* the panel simply stays hidden */
    }
  }, [ideaId]);

  useEffect(() => {
    load();
  }, [load, status]);

  if (!data || data.tickets.length === 0) return null;

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/ideas/${ideaId}/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "Could not send that. Try again in a moment.");
        return;
      }
      setResult(`Told ${d.notified} customer${d.notified === 1 ? "" : "s"}${d.emailed < d.notified ? `. ${d.notified - d.emailed} email${d.notified - d.emailed === 1 ? "" : "s"} could not be sent; the message is in their ticket.` : "."}`);
      setOpen(false);
      load();
    } catch {
      setError("Could not reach Idea HQ. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="reports-h" className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
      <h2 id="reports-h" className="font-semibold text-gray-900 dark:text-white">
        Asked for by {data.tickets.length} customer{data.tickets.length === 1 ? "" : "s"}
      </h2>
      <ul className="mt-2 space-y-1 text-sm text-gray-800 dark:text-gray-200">
        {data.tickets.map((t) => (
          <li key={t.id}>
            <Link href="/support" className="underline">#{t.number}</Link> {t.customerName || "Customer"}: {t.subject}
          </li>
        ))}
      </ul>

      {result && <p role="status" className="mt-3 text-sm text-emerald-800 dark:text-emerald-300">{result}</p>}
      {data.notifiedAt && !result && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">The customers were told on {new Date(data.notifiedAt).toLocaleDateString()}.</p>
      )}
      {!data.notifiedAt && status !== "done" && <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">When this is done, you can tell these customers in one click.</p>}
      {data.canNotify && !open && (
        <Button className="mt-3 bg-emerald-700 hover:bg-emerald-800" onClick={() => setOpen(true)}>
          Tell {data.reachable} customer{data.reachable === 1 ? "" : "s"} it is done
        </Button>
      )}
      {open && (
        <div className="mt-3 space-y-2">
          <Label htmlFor="notify-msg">Message to the customers</Label>
          <Textarea id="notify-msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} />
          <p className="text-xs text-gray-600 dark:text-gray-400">Each customer gets this in their ticket and by email, and their ticket is marked resolved. You can only do this once.</p>
          <div className="flex flex-wrap gap-2">
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy || !message.trim()} onClick={send}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send to {data.reachable}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
    </section>
  );
}
