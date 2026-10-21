"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Rocket, Loader2, GitPullRequest, ExternalLink, Check, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { RunProgress } from "./run-progress";

type Run = {
  id: string;
  kind: string;
  status: string;
  env: string | null;
  baseBranch: string | null;
  branch: string | null;
  prNumber: number | null;
  checksState: string | null;
  previewUrl?: string | null;
  agentNote?: string | null;
  costUsd: number | null;
  turns: number | null;
  provider?: string | null;
  model: string | null;
  effort: string | null;
  maxTurns: number | null;
  error: string | null;
  createdAt: string;
  startedAt?: string | null;
  project: { repoOwner: string | null; repoName: string | null; autoMerge: boolean };
};

type Rec = { model: string; effort: string; maxTurns: number; reason: string };
type ModelChoice = { id: string; label: string; note: string };
type Epic = { children: { id: string; title: string; status: string; complexity: string | null; hasPlan: boolean }[]; nextId: string | null };
const EFFORT_LABEL: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "maximum" };

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

export function RunPanel({ ideaId, projectId, plan }: { ideaId: string; projectId: string; plan: string | null }) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [rec, setRec] = useState<Rec | null>(null);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [efforts, setEfforts] = useState<string[]>(Object.keys(EFFORT_LABEL));
  const [prov, setProv] = useState<{ id: string; label: string; reportsCost: boolean; supportsTurnCap: boolean } | null>(null);
  const [epic, setEpic] = useState<Epic | null>(null);
  const [aiBuild, setAiBuild] = useState(true); // false: the owner switched AI build off for this account
  const [needsPlan, setNeedsPlan] = useState(false); // paywall: needs Pro or a runs pack
  const [capReached, setCapReached] = useState<string | null>(null); // the project's monthly spending cap is used up
  const [pick, setPick] = useState<{ model: string; effort: string; maxTurns: number } | null>(null);
  const [changing, setChanging] = useState(false);
  const lastStatus = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ideas/${ideaId}/runs`, { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        setRuns(j.runs);
        setRec(j.recommended);
        setModels(j.models || []);
        if (j.efforts) setEfforts(j.efforts);
        setProv(j.provider || null);
        setEpic(j.epic);
        setAiBuild(j.aiBuild !== false);
        setNeedsPlan(!!j.needsPlan);
        setCapReached(typeof j.capReached === "string" ? j.capReached : null);
      }
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
      if (!res.ok) setError(data.error || "That step did not finish. Try again in a moment.");
      else if (label === "revise") setInstruction("");
    } finally {
      setBusy(null);
      load();
    }
  };

  const prUrl = run?.prNumber && run.project.repoOwner ? `https://github.com/${run.project.repoOwner}/${run.project.repoName}/pull/${run.prNumber}` : null;
  const canStart = aiBuild && !needsPlan && !capReached && !epic && (!run || ["merged", "closed", "failed", "cancelled"].includes(run.status));
  const tier = pick ?? (rec ? { model: rec.model, effort: rec.effort, maxTurns: rec.maxTurns } : null);
  const label = (id: string) => models.find((m) => m.id === id)?.label ?? id;

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

        {loaded && !aiBuild && (
          <p role="status" className="rounded-lg border border-gray-400 p-3 text-sm text-gray-800 dark:border-gray-500 dark:text-gray-200">
            AI build is switched off for your account. Ask the owner.
          </p>
        )}
        {loaded && aiBuild && capReached && (
          <p role="status" className="rounded-lg border border-gray-400 p-3 text-sm text-gray-800 dark:border-gray-500 dark:text-gray-200">
            {capReached} <Link href="/projects" className="font-semibold text-emerald-800 underline dark:text-emerald-300">Open Projects</Link>
          </p>
        )}
        {loaded && aiBuild && needsPlan && (
          <p role="status" className="rounded-lg border border-gray-400 p-3 text-sm text-gray-800 dark:border-gray-500 dark:text-gray-200">
            AI build needs Pro or a runs pack. <Link href="/billing" className="font-semibold text-emerald-800 underline dark:text-emerald-300">Open Billing</Link>
          </p>
        )}

        {epic && (
          <div className="space-y-2 text-sm">
            <p className="text-gray-700 dark:text-gray-200">
              This idea is split into <b>{epic.children.length} stories</b> ({epic.children.filter((c) => c.status === "done").length} done). Stories are built one at a time, in order. Merge each one before starting the next.
            </p>
            <ol className="space-y-1">
              {epic.children.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="w-5 text-xs text-gray-400">{i + 1}.</span>
                  <Link href={`/ideas/${c.id}`} className="text-emerald-600 hover:underline truncate">{c.title}</Link>
                  <span className="text-xs text-gray-500 shrink-0">{c.complexity || ""} {c.status === "done" ? "done" : c.hasPlan ? "ready" : "needs build prompt"}</span>
                  {epic.nextId === c.id && <span className="text-xs px-1.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">next</span>}
                </li>
              ))}
            </ol>
            {epic.nextId && <Link href={`/ideas/${epic.nextId}`}><Button size="sm">Open the next story</Button></Link>}
          </div>
        )}

        {!plan && !epic && <p className="text-sm text-gray-400">Generate the build prompt first. It becomes the plan the AI follows.</p>}
        {loaded && !run && plan && !epic && (
          <p className="text-sm text-gray-400">
            The AI follows your build prompt in the project&apos;s GitHub repo and opens a pull request.{" "}
            <Link href={`/projects/${projectId}/setup`} className="text-emerald-600 hover:underline">Open the setup guide</Link> if this project is not connected yet.
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
              {run.model && <span className="text-xs text-gray-500">{label(run.model)} · {EFFORT_LABEL[run.effort || ""] || run.effort} effort</span>}
              {prUrl && (
                <a href={prUrl} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline inline-flex items-center gap-1">
                  <GitPullRequest className="w-4 h-4" /> PR #{run.prNumber} <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {run.previewUrl && run.status === "pr_open" && (
                <a href={run.previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-emerald-700 px-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                  See it running <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
              {!run.previewUrl && run.status === "pr_open" && run.kind === "implement" && (
                <span className="text-xs text-gray-600 dark:text-gray-400" title="Hosts like Vercel, Netlify and Cloudflare Pages post the preview address on the pull request a minute or two after it opens.">
                  No preview link yet
                </span>
              )}
              {run.costUsd == null && prov && !prov.reportsCost && run.status !== "awaiting_approval" && (
                <span className="text-xs text-gray-500">cost not reported by {prov.label.split(" ")[0]}</span>
              )}
              {run.costUsd != null && (
                <span className="text-xs text-gray-500">
                  ${run.costUsd.toFixed(2)}
                  {run.turns != null ? ` · ${run.turns} turns` : ""}
                </span>
              )}
            </div>

            {BUSY.includes(run.status) && <RunProgress key={run.id + (run.startedAt ?? "")} runId={run.id} startedAt={run.startedAt ?? run.createdAt} />}

            {aiBuild && !needsPlan && !capReached && run.status === "awaiting_approval" && plan && (
              <div className="space-y-2">
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-600 dark:text-gray-300">Review the plan the AI will follow</summary>
                  <pre className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 whitespace-pre-wrap font-sans text-sm max-h-80 overflow-auto">{plan}</pre>
                </details>
                {rec && tier && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2 text-sm">
                    <p className="text-gray-700 dark:text-gray-200">
                      <b>{label(tier.model)}</b>, {EFFORT_LABEL[tier.effort]} effort{prov?.supportsTurnCap === false ? "" : `, up to ${tier.maxTurns} turns`}
                      <span className="text-xs text-gray-500"> · chosen automatically: {rec.reason}</span>
                    </p>
                    <button type="button" className="text-xs text-emerald-600 hover:underline" onClick={() => setChanging(!changing)}>
                      {changing ? "Hide options" : "Change model and effort"}
                    </button>
                    {changing && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-gray-500">Model</label>
                          <Select value={tier.model} onChange={(e) => setPick({ ...tier, model: e.target.value })}>
                            {models.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.note}</option>)}
                          </Select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Effort</label>
                          <Select value={tier.effort} onChange={(e) => setPick({ ...tier, effort: e.target.value })}>
                            {efforts.map((k) => <option key={k} value={k}>{EFFORT_LABEL[k] || k}</option>)}
                          </Select>
                        </div>
                        {prov?.supportsTurnCap !== false && <div>
                          <label className="text-xs text-gray-500">Max turns</label>
                          <Select value={String(tier.maxTurns)} onChange={(e) => setPick({ ...tier, maxTurns: Number(e.target.value) })}>
                            {[10, 15, 30, 50, 80, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                          </Select>
                        </div>}
                      </div>
                    )}
                    <p className="text-xs text-gray-500">Stronger settings cost more. Small ideas do fine on the cheapest tier because build and tests must still pass before merge.</p>
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  This runs in your GitHub Actions with your API key, has a 30 minute limit, and ends as a pull request.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy !== null} onClick={() => act("approve", `/api/runs/${run.id}/approve`, pick ?? (rec ? { model: rec.model, effort: rec.effort, maxTurns: rec.maxTurns } : {}))}>
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
                {aiBuild && run.kind !== "revert" && (
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

            {run.error && <p className="text-sm text-red-700 dark:text-red-400">{run.error}</p>}
            {run.agentNote && (
              <details className="text-sm" open={run.status === "failed" || run.status === "closed" || run.status === "cancelled"}>
                <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">What the AI said</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 font-sans text-sm text-gray-800 dark:bg-gray-800/60 dark:text-gray-200">{run.agentNote}</pre>
              </details>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {error}{" "}
            <Link href={`/projects/${projectId}/setup`} className="underline">Open the setup guide</Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
