"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@/components/notice";

export function SettingsView() {
  const [email, setEmail] = useState<string | null>(null);
  const [notify, setNotify] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setEmail(d.email);
        setNotify(!!d.notifyEmail);
      })
      .catch(() => setNotice("Could not load your settings. Reload the page to try again."));
  }, []);

  const change = async (next: boolean) => {
    setSaving(true);
    setSaved(false);
    setNotice("");
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notifyEmail: next }) });
      if (!res.ok) throw new Error("not saved");
      setNotify(next);
      setSaved(true);
    } catch {
      setNotice("Could not save that setting. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-700 dark:text-gray-300">Your own preferences.</p>
      </div>
      <Notice text={notice} onClose={() => setNotice("")} />
      <section className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800" aria-labelledby="mail-h">
        <h2 id="mail-h" className="font-semibold text-gray-900 dark:text-white">Email</h2>
        <label className="mt-2 flex min-h-[44px] items-start gap-3 text-sm text-gray-900 dark:text-white">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0"
            checked={notify === true}
            disabled={notify === null || saving}
            onChange={(e) => change(e.target.checked)}
          />
          <span>
            Email me when a change is ready for review, or when the AI could not finish.
            <span className="block text-gray-700 dark:text-gray-300">Sent to {email ?? "your account address"}.</span>
          </span>
        </label>
        {saved && <p role="status" className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">Saved.</p>}
      </section>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        <Link href="/auth/change-password" className="underline">Change your password</Link> · <Link href="/billing" className="underline">Billing</Link>
      </p>
    </div>
  );
}
