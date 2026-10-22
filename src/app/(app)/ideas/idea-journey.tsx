"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, GitPullRequest, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { effectiveSize } from "@/lib/runs/size";
import { SIZE_NAMES, sizeExpectation } from "@/lib/runs/sizes";
import { JOURNEY_STAGES, buildExpectation, fixChecksRequest, journeyFor, type PrimaryAction, type Rec, type SecondaryAction } from "@/lib/runs/journey";
import { RunProgress } from "./run-progress";
import { RUNS_CHANGED, announceRunsChanged } from "./run-events";
import { COMPLEXITIES, type Idea } from "./ideas-shared";

type JRun = {
  id: string; kind: string; status: string; checksState: string | null; prNumber: number | null; previewUrl?: string | null;
  agentNote?: string | null; costUsd: number | null; turns: number | null; error: string | null; createdAt: string; startedAt?: string | null;
  project: { repoOwner: string | null; repoName: string | null };
};
type Data = {
  runs: JRun[]; recommended: Rec | null; epic: { children: { id: string; status: string }[]; nextId: string | null } | null;
  aiBuild: boolean; needsPlan: boolean; capReached: string | null; failingChecks: string[];
  provider: { reportsCost: boolean } | null;
};

async function call(url: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, unknown>; error: string | null }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json, error: res.ok ? null : typeof json.error === "string" ? json.error : "That step did not finish. Try again in a moment." };
  } catch {
    return { ok: false, json: {}, error: "Could not reach Idea HQ. Check your connection and try again." };
  }
}

// The idea page as one journey: Describe, Plan, Build, Review, Ship, with one button for the next step. It sits above
// the older cards (triage, stories, scope, build prompt, run panel), which still do everything it does and more.
export function IdeaJourney({
  idea, onEstimate, onPlan, onSplit, onReveal, onSetSize, blockedBy = [], onSaveClosure,
}: {
  idea: Idea;
  onEstimate: () => Promise<Idea | string>;
  onPlan: () => Promise<Idea | string>;
  onSplit: () => void;
  onReveal: (id: string) => void; // open the folded details and bring one part into view
  onSetSize: (value: string) => void; // the person sets the size by hand
  blockedBy?: string[];
  onSaveClosure: (text: string) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState("");
  const [asking, setAsking] = useState(false);
  const [closure, setClosure] = useState(idea.closureNote || "");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ideas/${idea.id}/runs`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* the next poll tries again */
    }
  }, [idea.id]);

  // Look again when the size changes: the model a new run would use depends on it.
  useEffect(() => { load(); }, [load, idea.complexity]);
  useEffect(() => {
    window.addEventListener(RUNS_CHANGED, load);
    return () => window.removeEventListener(RUNS_CHANGED, load);
  }, [load]);

  const run = data?.runs.find((r) => r.kind === "implement") ?? null;
  const waiting = run?.status === "awaiting_approval" ? run : null;
  const busyRun = !!run && ["dispatched", "running"].includes(run.status);
  const checking = run?.status === "pr_open" && run.checksState !== "green" && run.checksState !== "red";
  useEffect(() => {
    if (!busyRun && !checking) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [busyRun, checking, load]);

  // When the checks fail, the request box arrives filled in.
  const failingKey = (data?.failingChecks ?? []).join("|");
  useEffect(() => {
    if (run?.status === "pr_open" && run.checksState === "red") setRequest(fixChecksRequest(data?.failingChecks ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.checksState, failingKey]);
  useEffect(() => setClosure(idea.closureNote || ""), [idea.closureNote]);

  const size = effectiveSize(idea);
  const view = journeyFor({
    idea, run, epic: data?.epic ?? null,
    access: { aiBuild: data?.aiBuild !== false, needsPlan: !!data?.needsPlan, capReached: data?.capReached ?? null },
    recommended: data?.recommended ?? null, reportsCost: data?.provider?.reportsCost !== false, blockedBy,
  });
  const stageIndex = JOURNEY_STAGES.findIndex((s) => s.id === view.stage);

  const finish = async () => { setBusy(null); setStep(""); announceRunsChanged(); await load(); };

  const doPlan = async (force = false) => {
    setBusy("plan"); setError(null);
    try {
      let current: Idea = idea;
      if (!effectiveSize(current)) {
        setStep("Sizing the idea…");
        const r = await onEstimate();
        if (typeof r === "string") return setError(r);
        current = r;
      }
      // An Epic is split before anything is planned, unless the person chose to build it as one.
      if (!force && effectiveSize(current) === "XL") return;
      setStep("Writing the plan…");
      const r = await onPlan();
      if (typeof r === "string") setError(r);
    } finally {
      await finish();
    }
  };

  const startAndApprove = async () => {
    setBusy("build"); setError(null);
    try {
      let id = waiting?.id;
      if (!id) {
        const r = await call(`/api/ideas/${idea.id}/runs`);
        if (!r.ok) return setError(r.error);
        id = (r.json.run as { id: string }).id;
      }
      const a = await call(`/api/runs/${id}/approve`);
      if (!a.ok) setError(a.error);
    } finally {
      await finish();
    }
  };

  const buildAsOne = async () => {
    setBusy("build"); setError(null);
    if (!idea.plan) {
      setStep("Writing the plan…");
      const r = await onPlan();
      setStep("");
      if (typeof r === "string") {
        setError(r);
        return finish();
      }
    }
    await startAndApprove();
  };

  const adjust = async () => {
    setBusy("adjust"); setError(null);
    try {
      if (!waiting) {
        const r = await call(`/api/ideas/${idea.id}/runs`);
        if (!r.ok) return setError(r.error);
      }
    } finally {
      await finish();
    }
    onReveal("implement-with-ai");
  };

  const act = async (label: string, url: string, body?: unknown) => {
    setBusy(label); setError(null);
    try {
      const r = await call(url, body);
      if (!r.ok) setError(r.error);
      else if (label === "revise") { setAsking(false); setRequest(""); }
    } finally {
      await finish();
    }
  };

  const runPrimary = (a: PrimaryAction) => {
    if (a === "plan") return doPlan();
    if (a === "build" || a === "approve" || a === "retry") return startAndApprove();
    if (a === "split") return onSplit();
    if (a === "merge" && run) return act("merge", `/api/runs/${run.id}/merge`);
    if (a === "fix" && run) return act("revise", `/api/runs/${run.id}/revise`, { instruction: request });
  };
  const runSecondary = (a: SecondaryAction) => {
    if (a === "buildAsOne") return buildAsOne();
    if (a === "adjust") return adjust();
    if (a === "replan") return doPlan(true);
    if (a === "cancel" && run) return act("cancel", `/api/runs/${run.id}/cancel`);
    if (a === "closePr" && run) return act("cancel", `/api/runs/${run.id}/cancel`);
    if (a === "changes") {
      if (!asking && view.primary?.action !== "fix") setRequest("");
      setAsking(!asking);
    }
  };

  const prUrl = run?.prNumber && run.project.repoOwner ? `https://github.com/${run.project.repoOwner}/${run.project.repoName}/pull/${run.prNumber}` : null;
  const showBox = view.stage === "review" && (view.primary?.action === "fix" || asking);
  const reportsCost = data?.provider?.reportsCost !== false;

  return (
    <Card id="journey">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-xs text-gray-600 dark:text-gray-400 sm:hidden">Step {stageIndex + 1} of 5: {JOURNEY_STAGES[stageIndex].label}</p>
          <ol className="hidden flex-wrap gap-2 sm:flex" aria-label="Where this idea is">
            {JOURNEY_STAGES.map((s, i) => (
              <li
                key={s.id}
                aria-current={i === stageIndex ? "step" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                  i === stageIndex ? "border-gray-900 font-medium text-gray-900 dark:border-white dark:text-white" : "border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300"
                }`}
              >
                {i < stageIndex ? <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> : <span className="text-xs tabular-nums">{i + 1}</span>}
                {s.label}
                <span className="sr-only">{i < stageIndex ? " (done)" : i === stageIndex ? " (now)" : " (later)"}</span>
              </li>
            ))}
          </ol>
        </div>

        <p role="status" className="text-sm font-medium text-gray-900 dark:text-white">
          {busy === "plan" && step ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{step}</span>
          ) : (
            view.headline
          )}
        </p>

        {(view.stage === "describe" || view.stage === "plan") && !(data?.epic && data.epic.children.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="journey-size" className="text-xs">Size</Label>
            <Select id="journey-size" value={idea.complexity || ""} disabled={busy !== null} onChange={(e) => e.target.value && onSetSize(e.target.value)} className="w-auto text-sm">
              {!idea.complexity && <option value="">Not sized yet</option>}
              {COMPLEXITIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
            <span className="text-xs text-gray-600 dark:text-gray-400">Plan it sizes it for you. Choose one here to set it yourself.</span>
          </div>
        )}

        {view.stage === "plan" && idea.plan && size && (
          <div className="space-y-2 text-sm">
            <p className="text-gray-700 dark:text-gray-300">
              <b>{SIZE_NAMES[size]}</b>: {sizeExpectation(size, { withCost: reportsCost })}
            </p>
            {idea.scope && (
              <>
                <p className="font-medium text-gray-900 dark:text-white">What the AI will do</p>
                <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{idea.scope}</p>
              </>
            )}
            {view.primary && ["build", "approve"].includes(view.primary.action) && (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {buildExpectation(null, data?.recommended ?? null, reportsCost)}. That limit is a safety ceiling, not what it should take. The full brief is in the AI build prompt card below.
              </p>
            )}
          </div>
        )}

        {view.stage === "build" && run && (busyRun ? <RunProgress key={run.id + (run.startedAt ?? "")} runId={run.id} startedAt={run.startedAt ?? run.createdAt} /> : run.error && <p className="text-sm text-red-700 dark:text-red-400">{run.error}</p>)}

        {view.stage === "review" && run && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {prUrl && (
                <a href={prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400">
                  <GitPullRequest className="h-4 w-4" aria-hidden="true" /> PR #{run.prNumber} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
              {run.previewUrl && (
                <a href={run.previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400">
                  See it running <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
              {run.costUsd != null && <span className="text-xs text-gray-600 dark:text-gray-400">${run.costUsd.toFixed(2)}{run.turns != null ? ` · ${run.turns} turns` : ""}</span>}
            </div>
            {run.agentNote && (
              <div>
                <p className="font-medium text-gray-900 dark:text-white">What the AI said</p>
                <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-gray-700 dark:text-gray-300">{run.agentNote}</p>
              </div>
            )}
            {showBox && (
              <Textarea
                aria-label={view.primary?.action === "fix" ? "What to ask the AI to fix" : "What to change"}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="Say what to change, in plain words"
                className="min-h-[70px] text-sm"
              />
            )}
            {asking && view.primary?.action !== "fix" && (
              <Button size="sm" variant="outline" disabled={busy !== null || !request.trim()} onClick={() => run && act("revise", `/api/runs/${run.id}/revise`, { instruction: request })}>
                {busy === "revise" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : null}Send request
              </Button>
            )}
          </div>
        )}

        {view.stage === "ship" && (
          <div className="space-y-2 text-sm">
            {run?.status === "merged" && (run.turns != null || run.costUsd != null) && (
              <p className="text-gray-700 dark:text-gray-300">
                This took {run.turns != null ? `${run.turns} turns` : "an unknown number of turns"}{run.costUsd != null ? ` and $${run.costUsd.toFixed(2)}` : ""}
                {size ? `. A ${SIZE_NAMES[size]} idea is ${sizeExpectation(size, { withCost: reportsCost })}.` : "."}
              </p>
            )}
            <label htmlFor="journey-closure" className="flex items-baseline justify-between gap-2 font-medium text-gray-900 dark:text-white">
              Closing note
              {idea.closedAt && <span className="text-xs font-normal text-gray-600 dark:text-gray-400">Closed {new Date(idea.closedAt).toLocaleDateString()}</span>}
            </label>
            <Textarea
              id="journey-closure"
              value={closure}
              onChange={(e) => setClosure(e.target.value)}
              onBlur={() => closure.trim() !== (idea.closureNote || "") && onSaveClosure(closure.trim())}
              placeholder="What shipped, or why this is done"
              className="min-h-[60px] text-sm"
            />
            <p className="text-xs text-gray-600 dark:text-gray-400">Drafted from what the AI said when it finished. Edit it if you like; it saves when you click away.</p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        {view.blocked && <p role="status" className="rounded-lg border border-gray-400 p-3 text-sm text-gray-800 dark:border-gray-500 dark:text-gray-200">{view.blocked}</p>}

        {(view.primary || view.secondary.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {view.primary?.action === "nextStep" && data?.epic?.nextId ? (
              <Link href={`/ideas/${data.epic.nextId}`} className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800">{view.primary.label}</Link>
            ) : view.primary?.action === "home" ? (
              <Link href="/ideas" className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800">{view.primary.label}</Link>
            ) : view.primary ? (
              <Button disabled={busy !== null || (view.primary.action === "fix" && !request.trim())} onClick={() => runPrimary(view.primary!.action)} className="bg-emerald-700 hover:bg-emerald-800">
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : view.primary.action === "plan" ? <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" /> : null}
                {view.primary.label}
              </Button>
            ) : null}
            {view.secondary.map((s) => (
              <Button key={s.action} variant={s.action === "closePr" ? "ghost" : "outline"} size="sm" disabled={busy !== null} onClick={() => runSecondary(s.action)}>
                {s.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
