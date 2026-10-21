"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
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

  const signOutEverywhere = async () => {
    setNotice("");
    try {
      const res = await fetch("/api/auth/revoke-sessions", { method: "POST" });
      if (!res.ok) throw new Error("not done");
      await signOut({ callbackUrl: "/auth/signin" });
    } catch {
      setNotice("Could not sign you out everywhere. Check your connection and try again.");
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
      <section className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800" aria-labelledby="sessions-h">
        <h2 id="sessions-h" className="font-semibold text-gray-900 dark:text-white">Signed-in devices</h2>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">Lost a device, or used a shared computer? This signs you out everywhere, including here.</p>
        <button type="button" onClick={signOutEverywhere} className="mt-2 min-h-[44px] rounded-lg border border-gray-400 px-4 text-sm font-medium text-gray-900 hover:bg-gray-100 dark:border-gray-500 dark:text-white dark:hover:bg-gray-700">
          Sign out on all devices
        </button>
      </section>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        <Link href="/auth/change-password" className="underline">Change your password</Link> · <Link href="/billing" className="underline">Billing</Link>
      </p>
    </div>
  );
}
