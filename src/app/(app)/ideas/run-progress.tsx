"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Circle, Loader2 } from "lucide-react";

type Stage = { id: string; label: string; state: "done" | "active" | "waiting"; startedAt: string | null };
type Progress = { active: boolean; elapsedMs: number | null; stages: Stage[] | null; stageElapsedMs: number | null };

const POLL_MS = 10000;

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// A running run, made visible: a clock that counts up, the stages it goes through with the one under way marked,
// and when GitHub last confirmed it. The stage list comes from GitHub every few seconds, so a moving stage is
// proof that work is happening, not just a clock.
export function RunProgress({ runId, startedAt }: { runId: string; startedAt: string | null }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const misses = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/progress`, { cache: "no-store" });
        if (!res.ok) throw new Error("not ok");
        const j = (await res.json()) as Progress;
        if (!live) return;
        misses.current = 0;
        setFailed(false);
        setProgress(j);
        setReceivedAt(Date.now());
      } catch {
        if (!live) return;
        misses.current += 1;
        if (misses.current >= 2) setFailed(true);
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [runId]);

  const sinceReceived = receivedAt ? now - receivedAt : 0;
  const started = startedAt ? Date.parse(startedAt) : NaN;
  const elapsed =
    progress?.elapsedMs != null ? progress.elapsedMs + sinceReceived : Number.isFinite(started) ? now - started : null;
  const stages = progress?.stages ?? null;
  const current = stages?.find((s) => s.state === "active") ?? null;
  const stageElapsed = progress?.stageElapsedMs != null ? progress.stageElapsedMs + sinceReceived : null;
  const age = receivedAt ? Math.max(0, Math.floor((now - receivedAt) / 1000)) : null;

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700" data-testid="run-progress">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          Working for <span className="tabular-nums">{elapsed != null ? clock(elapsed) : "0:00"}</span>
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {failed
            ? "Progress details are not available right now. The run is still going."
            : age == null
            ? "Asking GitHub…"
            : `Confirmed with GitHub ${age < 3 ? "just now" : `${age}s ago`}`}
        </p>
      </div>

      {stages ? (
        <ol className="mt-2 space-y-1.5">
          {stages.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm" aria-current={s.state === "active" ? "step" : undefined}>
              {s.state === "done" ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              ) : s.state === "active" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-700 motion-reduce:animate-none dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              )}
              <span className={s.state === "waiting" ? "text-gray-600 dark:text-gray-400" : "text-gray-900 dark:text-gray-100"}>
                {s.label}
                <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "active" ? " (now)" : " (not started)"}</span>
              </span>
              {s.state === "active" && stageElapsed != null && <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">{clock(stageElapsed)}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-700 motion-reduce:animate-none dark:text-emerald-400" aria-hidden="true" />
          Waiting for GitHub to report the first step…
        </p>
      )}

      {/* Said once per stage, not every second. */}
      <p role="status" className="sr-only">{current ? `Now: ${current.label}` : ""}</p>

      {current?.id === "ai" && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          This is the slow part: the AI reads your code, makes the change and runs your checks. It can take several minutes.
        </p>
      )}
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
        You can leave this page. The run keeps going on GitHub, and with email switched on in Settings you get an email when it is ready.
      </p>
    </div>
  );
}
