"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  paywall: boolean; owner: boolean; freeAccess: boolean; pro: boolean; subStatus: string | null; subEndsAt: string | null;
  credits: number; packSize: number; proPrice: string; proUrl: string | null; creditsUrl: string | null; portalUrl: string | null;
};

const btn = "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800";
const btnOutline = "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-400 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-500 dark:text-white dark:hover:bg-gray-800";

export function BillingView() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/billing", { cache: "no-store" });
    if (!res.ok) return setError("Could not load your plan.");
    setS(await res.json());
    setError("");
  }, []);

  useEffect(() => {
    load();
    // A payment takes a few seconds to arrive: check again when the person comes back to this tab.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const params = new URLSearchParams(window.location.search);
    const t = params.get("thanks") ? setInterval(load, 4000) : null;
    const stop = t ? setTimeout(() => clearInterval(t), 60000) : null;
    return () => {
      window.removeEventListener("focus", onFocus);
      if (t) clearInterval(t);
      if (stop) clearTimeout(stop);
    };
  }, [load]);

  const ends = s?.subEndsAt ? new Date(s.subEndsAt).toLocaleDateString() : null;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Billing</h1>
        <p className="text-sm text-gray-700 dark:text-gray-300">AI build (Implement and Learn deeply) runs in your own GitHub. Plans and prepaid runs pay for it.</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error} <button className="underline" onClick={load}>Try again</button></p>}
      {!s && !error && <div aria-busy="true" aria-label="Loading your plan" className="h-40 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />}

      {s && (
        <>
          <section className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800" aria-labelledby="now-h">
            <h2 id="now-h" className="font-semibold text-gray-900 dark:text-white">Your plan right now</h2>
            <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
              {s.owner
                ? "You are the owner: everything is open to you."
                : !s.paywall
                ? "AI build is open to everyone for now. Nothing to pay."
                : s.freeAccess
                ? "You have free access. Nothing to pay."
                : s.pro
                ? s.subStatus === "cancelled" && ends ? `Pro, ending ${ends}. You keep it until then.` : "Pro: AI runs without a limit."
                : "Free. You can use the helper AI (estimates and plans) every day. AI build needs Pro or a runs pack."}
            </p>
            {!s.freeAccess && (
              <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                Prepaid AI runs left: <b>{s.credits}</b>{s.pro ? " (not used while Pro is active)" : ""}
                {s.owner && s.pro ? " · Subscription: Pro" : ""}
              </p>
            )}
            {!s.paywall && (
              <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">Payments are not switched on for everyone yet; buying here works, but nothing is required.</p>
            )}
            {s.portalUrl && s.pro && (
              <p className="mt-3"><a className={btnOutline} href={s.portalUrl} target="_blank" rel="noopener noreferrer">Manage or cancel your subscription</a></p>
            )}
          </section>

          {!s.freeAccess && (
            <div className="grid gap-4 sm:grid-cols-2">
              <section className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800" aria-labelledby="pro-h">
                <h2 id="pro-h" className="font-semibold text-gray-900 dark:text-white">Pro · {s.proPrice}</h2>
                <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">Every tool, and AI runs without a limit. Cancel any time.</p>
                <p className="mt-3">
                  {s.pro ? <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">You have Pro</span>
                    : s.proUrl ? <a className={btn} href={s.proUrl}>Get Pro</a>
                    : <span className="text-sm text-gray-700 dark:text-gray-300">Not available yet.</span>}
                </p>
              </section>
              <section className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800" aria-labelledby="pack-h">
                <h2 id="pack-h" className="font-semibold text-gray-900 dark:text-white">{s.packSize} AI runs · one payment</h2>
                <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">No subscription. One run is used each time you approve an AI run. A run that fails gives its run back.</p>
                <p className="mt-3">
                  {s.creditsUrl ? <a className={btn} href={s.creditsUrl}>Buy {s.packSize} runs</a>
                    : <span className="text-sm text-gray-700 dark:text-gray-300">Not available yet.</span>}
                </p>
              </section>
            </div>
          )}
          {(s.paywall || s.owner) && (
            <p className="text-xs text-gray-600 dark:text-gray-400 ">
              Payments go through Lemon Squeezy. It can take a few seconds before your plan updates after paying; this page checks again by itself.
            </p>
          )}
        </>
      )}
    </div>
  );
}
