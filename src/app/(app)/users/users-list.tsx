"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type U = {
  id: string; name: string | null; email: string | null; approved: boolean; features: string[]; aiBuild: boolean;
  aiDailyLimit: number | null; freeAccess: boolean; aiCredits: number; pro: boolean; proRevoked: boolean; lsSubscriptionId: string | null; emailWarning?: "duplicate" | "padded" | null; subStatus: string | null; subEndsAt: string | null; aiCallsToday: number; createdAt: string; owner: boolean; projects: number; ideas: number; runs: number;
};
type Patch = Partial<{ approved: boolean; features: string[]; aiBuild: boolean; aiDailyLimit: number | null; freeAccess: boolean; aiCredits: number }>;

export function UsersList() {
  const [users, setUsers] = useState<U[] | null>(null);
  const [defaultLimit, setDefaultLimit] = useState(20);
  const [paywall, setPaywall] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (!res.ok) return setError("Could not load the people list.");
    const d = await res.json();
    setUsers(d.users);
    setDefaultLimit(d.defaultDailyLimit ?? 20);
    setPaywall(!!d.paywall);
    setError("");
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter((u) => !q || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q));
  }, [users, query]);
  const waiting = shown.filter((u) => !u.approved && !u.owner);
  const rest = shown.filter((u) => u.approved || u.owner);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin</h1>
          <p className="text-sm text-gray-700 dark:text-gray-300">Who is allowed in, and what each person can use. The owner is always allowed and is never limited.</p>
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="people-search" className="sr-only">Search people</label>
          <Input id="people-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error} <button className="underline" onClick={load}>Try again</button>
        </p>
      )}

      {users === null && !error && (
        <div aria-busy="true" aria-label="Loading people" className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />)}
        </div>
      )}

      {users && waiting.length > 0 && (
        <section aria-labelledby="waiting-h" className="space-y-3">
          <h2 id="waiting-h" className="text-lg font-semibold text-gray-900 dark:text-white">Waiting for approval ({waiting.length})</h2>
          {waiting.map((u) => <Row key={u.id} u={u} defaultLimit={defaultLimit} paywall={paywall} onChanged={load} />)}
        </section>
      )}

      {users && (
        <section aria-labelledby="all-h" className="space-y-3">
          <h2 id="all-h" className="text-lg font-semibold text-gray-900 dark:text-white">People ({rest.length})</h2>
          {rest.length === 0 && <p className="text-sm text-gray-700 dark:text-gray-300">{query ? "Nobody matches that search." : "No one yet."}</p>}
          {rest.map((u) => <Row key={u.id} u={u} defaultLimit={defaultLimit} paywall={paywall} onChanged={load} />)}
        </section>
      )}
      <p className="text-xs text-gray-600 dark:text-gray-400">Usage is counted per UTC day. A limit of 0 switches off helper AI (estimates, plans, drafts) and AI answers in that person&apos;s Support widgets. AI build is the Implement and Learn deeply buttons.</p>
    </div>
  );
}

function Row({ u, defaultLimit, paywall, onChanged }: { u: U; defaultLimit: number; paywall: boolean; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [limitText, setLimitText] = useState(u.aiDailyLimit === null ? "" : String(u.aiDailyLimit));
  const [creditsText, setCreditsText] = useState(String(u.aiCredits));
  useEffect(() => {
    setLimitText(u.aiDailyLimit === null ? "" : String(u.aiDailyLimit));
  }, [u.aiDailyLimit]);
  useEffect(() => {
    setCreditsText(String(u.aiCredits));
  }, [u.aiCredits]);

  const save = async (patch: Patch) => {
    setSaving(true);
    setErr("");
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Could not save.");
      setLimitText(u.aiDailyLimit === null ? "" : String(u.aiDailyLimit));
      return;
    }
    onChanged();
  };

  const saveLimit = () => {
    const t = limitText.trim();
    const current = u.aiDailyLimit === null ? "" : String(u.aiDailyLimit);
    if (t === current) return;
    if (t === "") return save({ aiDailyLimit: null });
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      setErr("Use a whole number from 0 to 1000, or leave it empty for the default.");
      setLimitText(current);
      return;
    }
    save({ aiDailyLimit: n });
  };

  const saveCredits = () => {
    const t = creditsText.trim();
    if (t === String(u.aiCredits)) return;
    const n = Number(t);
    if (t === "" || !Number.isInteger(n) || n < 0 || n > 100000) {
      setErr("Run credits must be a whole number, 0 or more.");
      setCreditsText(String(u.aiCredits));
      return;
    }
    save({ aiCredits: n });
  };

  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const setPro = async (revoked: boolean) => {
    setSaving(true);
    setErr("");
    setNote("");
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proRevoked: revoked }) });
    setSaving(false);
    setConfirming(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Could not change Pro. Try again in a moment.");
    if (!revoked) setNote("Pro restored. If their subscription is still running, they have Pro again.");
    else if (d.lsCancel === "cancelled") setNote("Pro is off and the subscription was cancelled at Lemon Squeezy, so they will not be charged again.");
    else if (d.lsCancel === "failed") setNote("Pro is off, but Lemon Squeezy would not cancel the subscription. Cancel it in the Lemon Squeezy dashboard so they are not charged.");
    else setNote("Pro is off. The subscription is still running at Lemon Squeezy: cancel it there too, or they will keep being charged.");
    onChanged();
  };

  const limit = u.aiDailyLimit ?? defaultLimit;
  const plan = u.proRevoked ? "Free (Pro switched off by you)" : u.pro ? `Pro${u.subStatus === "cancelled" && u.subEndsAt ? ` until ${new Date(u.subEndsAt).toLocaleDateString()}` : ""}` : "Free";
  const hasTickets = u.features.includes("tickets");
  const toggle = "h-5 w-5 shrink-0";
  const label = "flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-white";

  return (
    <div className={`rounded-xl border bg-white p-4 dark:bg-gray-800 ${u.approved || u.owner ? "border-gray-300 dark:border-gray-600" : "border-amber-500"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900 dark:text-white">
            {u.name || u.email}
            {u.owner && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100">Owner</span>}
          </p>
          <p className="truncate text-xs text-gray-700 dark:text-gray-300">{u.email}</p>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            Joined {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })} · {u.projects} project{u.projects === 1 ? "" : "s"} · {u.ideas} idea{u.ideas === 1 ? "" : "s"} · {u.runs} AI run{u.runs === 1 ? "" : "s"}
          </p>
        </div>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-gray-600" aria-label="Saving" />}
        {!u.owner && !u.approved && (
          <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => save({ approved: true })} disabled={saving}>Approve</Button>
        )}
      </div>

      {u.owner ? (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">The owner has every feature and no AI limits.</p>
      ) : (
        <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <label className={label}>
            <input type="checkbox" className={toggle} checked={u.approved} disabled={saving} onChange={(e) => save({ approved: e.target.checked })} />
            Allowed in
          </label>
          <label className={label}>
            <input type="checkbox" className={toggle} checked={hasTickets} disabled={saving}
              onChange={(e) => save({ features: e.target.checked ? Array.from(new Set([...u.features, "tickets"])) : u.features.filter((f) => f !== "tickets") })} />
            Support tickets
          </label>
          <label className={label}>
            <input type="checkbox" className={toggle} checked={u.aiBuild} disabled={saving} onChange={(e) => save({ aiBuild: e.target.checked })} />
            AI build (Implement, Learn deeply)
          </label>
          <label className={label}>
            <input type="checkbox" className={toggle} checked={u.freeAccess} disabled={saving} onChange={(e) => save({ freeAccess: e.target.checked })} />
            Free access (skips payment)
          </label>
          <div className="flex min-h-[44px] flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-white">
            <label htmlFor={`cred-${u.id}`}>Run credits</label>
            <Input id={`cred-${u.id}`} className="h-9 w-24" inputMode="numeric" value={creditsText} disabled={saving}
              onChange={(e) => setCreditsText(e.target.value)} onBlur={saveCredits} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-describedby={`cred-note-${u.id}`} />
            <span id={`cred-note-${u.id}`} className="text-xs text-gray-700 dark:text-gray-300">Plan: {plan}{paywall ? "" : " (payments are not switched on yet)"}</span>
          </div>
          <div className="flex min-h-[44px] flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-white">
            <label htmlFor={`lim-${u.id}`}>Helper AI calls per day</label>
            <Input id={`lim-${u.id}`} className="h-9 w-24" inputMode="numeric" value={limitText} placeholder={`${defaultLimit}`} disabled={saving}
              onChange={(e) => setLimitText(e.target.value)} onBlur={saveLimit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-describedby={`lim-note-${u.id}`} />
            <span id={`lim-note-${u.id}`} className="text-xs text-gray-700 dark:text-gray-300">
              {limit === 0 ? "off" : `used ${u.aiCallsToday} of ${limit} today`}{u.aiDailyLimit === null ? " (default)" : ""}
            </span>
          </div>
        </div>
      )}
      {!u.owner && (u.pro || u.proRevoked) && (
        <div className="mt-2 flex min-h-[44px] flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-white">
          {u.proRevoked ? (
            <>
              <span>Pro is switched off for this person, even if they pay.</span>
              <Button variant="outline" size="sm" disabled={saving} onClick={() => setPro(false)}>Restore Pro</Button>
            </>
          ) : confirming ? (
            <>
              <span>Switch off Pro for {u.name || u.email}? They lose it now and the subscription is cancelled.</span>
              <Button size="sm" className="bg-red-700 hover:bg-red-800" disabled={saving} onClick={() => setPro(true)}>Yes, switch it off</Button>
              <Button variant="outline" size="sm" disabled={saving} onClick={() => setConfirming(false)}>Keep Pro</Button>
            </>
          ) : (
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setConfirming(true)}>Switch off Pro</Button>
          )}
          {u.lsSubscriptionId && (
            <a className="text-xs underline" href={`https://app.lemonsqueezy.com/subscriptions/${encodeURIComponent(u.lsSubscriptionId)}`} target="_blank" rel="noopener noreferrer">Open in Lemon Squeezy</a>
          )}
        </div>
      )}
      {note && <p role="status" className="mt-1 text-sm text-gray-800 dark:text-gray-200">{note}</p>}
      {u.emailWarning && !u.owner && (
        <div role="alert" className="mt-2 rounded-lg border border-red-700 bg-red-50 p-3 text-sm text-red-900 dark:border-red-400 dark:bg-red-950/40 dark:text-red-100">
          <p className="font-semibold">Suspicious email</p>
          <p className="mt-1">
            {u.emailWarning === "duplicate"
              ? "Another account has this email in different letters. Someone may be pretending to be that person. If you did not create both, remove this one."
              : "This email has spaces around it, which a normal sign-up does not produce. If you do not recognise this person, remove the account."}
          </p>
          <RemoveAccount user={u} onDone={onChanged} />
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}

// Removing an account (two steps; an account with work in it needs a second, stronger confirmation).
function RemoveAccount({ user, onDone }: { user: U; onDone: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const remove = async (force: boolean) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && !force) {
        setMsg(d.error || "This account has work in it.");
        setStep(2);
        return;
      }
      if (!res.ok) {
        setMsg(d.error || "Could not remove the account. Try again in a moment.");
        return;
      }
      onDone();
    } catch {
      setMsg("Could not reach Idea HQ. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {step === 0 && <Button variant="outline" size="sm" onClick={() => setStep(1)}>Remove this account</Button>}
      {step === 1 && (
        <>
          <span>Remove {user.email}?</span>
          <Button size="sm" className="bg-red-700 hover:bg-red-800" disabled={busy} onClick={() => remove(false)}>Yes, remove it</Button>
          <Button variant="outline" size="sm" onClick={() => setStep(0)}>Keep it</Button>
        </>
      )}
      {step === 2 && (
        <>
          <Button size="sm" className="bg-red-700 hover:bg-red-800" disabled={busy} onClick={() => remove(true)}>Remove it and its work</Button>
          <Button variant="outline" size="sm" onClick={() => { setStep(0); setMsg(""); }}>Keep it</Button>
        </>
      )}
      {msg && <span role="status">{msg}</span>}
    </div>
  );
}
