"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Notice } from "@/components/notice";

type Summary = { email: string | null; hasPassword: boolean; blocked: string | null };

// "Your data": download everything held about the account, or delete the account. Used on Settings and on the
// waiting-for-approval page (a person who was never approved can still leave and take their data).
export function AccountData() {
  const [info, setInfo] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/auth/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/auth/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm, password }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(d.error || "The account could not be deleted. Try again in a moment.");
        setBusy(false);
        return;
      }
      await signOut({ callbackUrl: "/?deleted=1" });
    } catch {
      setNotice("Could not reach Idea HQ. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800" aria-labelledby="data-h">
      <h2 id="data-h" className="font-semibold text-gray-900 dark:text-white">Your data</h2>
      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
        Download everything Idea HQ holds about your account as one file, or delete the account and everything in it.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <form method="get" action="/api/auth/account/export">
          <button type="submit" className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-400 px-4 text-sm font-medium text-gray-900 hover:bg-gray-100 dark:border-gray-500 dark:text-white dark:hover:bg-gray-700">
            Download my data
          </button>
        </form>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] rounded-lg border border-red-700 px-4 text-sm font-medium text-red-800 hover:bg-red-50 dark:border-red-400 dark:text-red-200 dark:hover:bg-red-950/40">
            Delete my account
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={remove} className="mt-3 space-y-3 rounded-lg border border-red-700 p-3 dark:border-red-400">
          <Notice text={notice} />
          {info?.blocked ? (
            <p role="alert" className="text-sm text-red-900 dark:text-red-100">{info.blocked}</p>
          ) : (
            <>
              <p className="text-sm text-gray-900 dark:text-white">
                This permanently deletes your account, your projects, ideas, runs, project knowledge, support spaces and tickets, and your GitHub connections. It cannot be undone.
                Your GitHub repositories are not touched: remove the Idea HQ app and the <code>.github/workflows/idea-hq.yml</code> file there yourself if you want them gone.
              </p>
              <div>
                <label htmlFor="del-confirm" className="block text-sm font-medium text-gray-900 dark:text-white">{info?.email ? "Type your email address to confirm" : "Type DELETE to confirm"}</label>
                <input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-md border border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-white" />
              </div>
              {info?.hasPassword && (
                <div>
                  <label htmlFor="del-password" className="block text-sm font-medium text-gray-900 dark:text-white">Your password</label>
                  <input id="del-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mt-1 w-full rounded-md border border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-white" />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || !confirm.trim() || (!!info?.hasPassword && !password)} className="min-h-[44px] rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
                  {busy ? "Deleting…" : "Delete everything"}
                </button>
                <button type="button" onClick={() => { setOpen(false); setNotice(""); }} disabled={busy} className="min-h-[44px] rounded-lg border border-gray-400 px-4 text-sm font-medium text-gray-900 dark:border-gray-500 dark:text-white">
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </section>
  );
}
