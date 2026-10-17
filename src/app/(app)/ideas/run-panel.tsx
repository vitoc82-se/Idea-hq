"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, Loader2, GitPullRequest, ExternalLink, Check, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Run = {
  id: string;
  kind: string;
  status: string;
  env: string | null;
  baseBranch: string | null;
  branch: string | null;
  prNumber: number | null;
  checksState: string | null;
  costUsd: number | null;
  turns: number | null;
  error: string | null;
  createdAt: string;
  project: { repoOwner: string | null; repoName: string | null; autoMerge: boolean };
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: "Waiting for your approval",
  dispatched: "Starting",
  running: "AI is working",
  pr_open: "PR ready for review",
  merged: "Merged",
  closed: "PR closed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const BUSY = ["dispatched", "running"];

export function RunPanel({ ideaId, plan }: { ideaId: string; plan: string | null }) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const lastStatus = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ideas/${ideaId}/runs`, { cache: "no-store" });
      if (res.ok) setRuns((await res.json()).runs);
    } finally {
      setLoaded(true);
    }
  }, [ideaId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = runs[0];
  const needsPolling =
    !!run && (BUSY.includes(run.status) || (run.status === "pr_open" && run.checksState !== "green" && run.checksState !== "red"));

  useEffect(() => {
    if (!needsPolling) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [needsPolling, load]);

  // Refresh the page (idea status, closure note) when a run reaches "merged".
  useEffect(() => {
    if (run && lastStatus.current && lastStatus.current !== run.status && run.status === "merged") router.refresh();
    lastStatus.current = run?.status ?? null;
  }, [run, router]);

  const act = async (label: string, url: string, body?: unknown) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Something went wrong.");
      else if (label === "revise") setInstruction("");
    } finally {
      setBusy(null);
      load();
    }
  };

  const prUrl = run?.prNumber && run.project.repoOwner ? `https://github.com/${run.project.repoOwner}/${run.project.repoName}/pull/${run.prNumber}` : null;
  const canStart = !run || ["merged", "closed", "failed", "cancelled"].includes(run.status);

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
            <Rocket className="w-4 h-4 text-emerald-600" />
            Implement with AI
          </span>
          {canStart && (
            <Button size="sm" disabled={!plan || busy !== null} onClick={() => act("start", `/api/ideas/${ideaId}/runs`)}>
              {busy === "start" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {run ? "Implement again" : "Implement"}
            </Button>
          )}
        </div>

        {!plan && <p className="text-sm text-gray-400">Generate the build prompt first. It becomes the plan the AI follows.</p>}
        {loaded && !run && plan && (
          <p className="text-sm text-gray-400">
            The AI follows your build prompt in the project&apos;s GitHub repo and opens a pull request. Connect the repo under Projects first.
          </p>
        )}

        {run && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
                {run.kind === "revert" ? "Revert: " : ""}
                {STATUS_LABEL[run.status] || run.status}
              </span>
              {BUSY.includes(run.status) && <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />}
              {run.env && <span className="text-xs text-gray-500">{run.env} · {run.baseBranch}</span>}
              {prUrl && (
                <a href={prUrl} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline inline-flex items-center gap-1">
                  <GitPullRequest className="w-4 h-4" /> PR #{run.prNumber} <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {run.costUsd != null && (
                <span className="text-xs text-gray-500">
                  ${run.costUsd.toFixed(2)}
                  {run.turns != null ? ` · ${run.turns} turns` : ""}
                </span>
              )}
            </div>

            {run.status === "awaiting_approval" && plan && (
              <div className="space-y-2">
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-600 dark:text-gray-300">Review the plan the AI will follow</summary>
                  <pre className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 whitespace-pre-wrap font-sans text-sm max-h-80 overflow-auto">{plan}</pre>
                </details>
                <p className="text-xs text-gray-500">
                  This runs in your GitHub Actions with your API key, capped at 30 minutes and 40 turns, and ends as a pull request.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy !== null} onClick={() => act("approve", `/api/runs/${run.id}/approve`)}>
                    {busy === "approve" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Approve and run
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("cancel", `/api/runs/${run.id}/cancel`)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {BUSY.includes(run.status) && (
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("cancel", `/api/runs/${run.id}/cancel`)}>
                Cancel run
              </Button>
            )}

            {run.status === "pr_open" && (
              <div className="space-y-3">
                <p className="text-sm flex items-center gap-1.5">
                  {run.checksState === "green" ? (
                    <><Check className="w-4 h-4 text-emerald-600" /> Build and tests passed</>
                  ) : run.checksState === "red" ? (
                    <><AlertTriangle className="w-4 h-4 text-red-500" /> Checks failed. Request a change or close the PR.</>
                  ) : (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Waiting for checks…</>
                  )}
                  {run.project.autoMerge && run.kind === "implement" && <span className="text-xs text-gray-500">· auto-merges when green</span>}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy !== null || (run.kind !== "revert" && run.checksState !== "green") || run.checksState === "red"}
                    onClick={() => act("merge", `/api/runs/${run.id}/merge`)}
                  >
                    {busy === "merge" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Approve and merge
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("cancel", `/api/runs/${run.id}/cancel`)}>
                    Close PR
                  </Button>
                </div>
                {run.kind !== "revert" && (
                  <div className="space-y-2">
                    <Textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="Request a change, e.g. use the existing Button component and add a test for the empty state"
                      className="min-h-[70px] text-sm"
                    />
                    <Button size="sm" variant="outline" disabled={busy !== null || !instruction.trim()} onClick={() => act("revise", `/api/runs/${run.id}/revise`, { instruction })}>
                      {busy === "revise" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Request changes
                    </Button>
                  </div>
                )}
              </div>
            )}

            {run.status === "merged" && run.kind === "implement" && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("revert", `/api/runs/${run.id}/revert`)}>
                {busy === "revert" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Revert this change
              </Button>
            )}

            {run.error && <p className="text-sm text-red-600 dark:text-red-400">{run.error}</p>}
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
