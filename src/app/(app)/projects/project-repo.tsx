"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Github, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PUBLIC_REPO_NOTICE } from "@/lib/runs/public-safe";

type Repo = { owner: string; name: string; defaultBranch: string; isPrivate?: boolean };
type Available = { installationId: number; repos: Repo[]; error?: string; configureUrl?: string };
type Data = {
  appConfigured: boolean;
  project: {
    installationId: number | null; repoOwner: string | null; repoName: string | null;
    envBranches: Record<string, string> | null; defaultEnv: string | null; autoMerge: boolean;
    buildCommand: string | null; testCommand: string | null; aiBias?: string; aiProvider?: string; workflowInstalled: boolean; workflowOutdated?: boolean; setupPrNumber: number | null; repoPublic?: boolean;
  };
  available: Available[];
  providers?: { id: string; label: string; secretName: string; keyHelpUrl: string; keyHelpText: string }[];
  siblings?: { id: string; name: string; repo: string; provider: string }[];
};

export function ProjectRepo({
  projectId,
  showSetup = true,
  suggestions,
  onSaved,
  onChanged,
  returnTo,
}: {
  projectId: string;
  returnTo?: string;
  showSetup?: boolean;
  suggestions?: { build: string | null; test: string | null };
  onSaved?: () => void;
  onChanged?: () => void; // fires after every (re)load, so progress chips stay in step
}) {
  const [data, setData] = useState<Data | null>(null);
  const [repoKey, setRepoKey] = useState("");
  const [envs, setEnvs] = useState<{ name: string; branch: string }[]>([{ name: "live", branch: "main" }]);
  const [defaultEnv, setDefaultEnv] = useState("live");
  const [build, setBuild] = useState("");
  const [test, setTest] = useState("");
  const [autoMerge, setAutoMerge] = useState(false);
  const [aiBias, setAiBias] = useState("auto");
  const [aiProvider, setAiProvider] = useState("claude");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/repo`, { cache: "no-store" });
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    const p = d.project;
    if (p.repoOwner) setRepoKey(`${p.installationId}|${p.repoOwner}|${p.repoName}`);
    if (p.envBranches && Object.keys(p.envBranches).length) {
      setEnvs(Object.entries(p.envBranches).map(([name, branch]) => ({ name, branch })));
      setDefaultEnv(p.defaultEnv || Object.keys(p.envBranches)[0]);
    }
    setBuild(p.buildCommand || "");
    setTest(p.testCommand || "");
    setAutoMerge(p.autoMerge);
    setAiBias(p.aiBias || "auto");
    setAiProvider(p.aiProvider || "claude");
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data) onChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Coming back from GitHub (after adding repos) refreshes the list by itself.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (!data) return <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />;

  const repos = data.available.flatMap((a) => a.repos.map((r) => ({ key: `${a.installationId}|${r.owner}|${r.name}`, label: `${r.owner}/${r.name}` })));

  const save = async () => {
    const [inst, owner, name] = repoKey.split("|");
    setBusy("save");
    setMsg(null);
    const res = await fetch(`/api/projects/${projectId}/repo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installationId: Number(inst), repoOwner: owner, repoName: name,
        envBranches: Object.fromEntries(envs.filter((e) => e.name && e.branch).map((e) => [e.name, e.branch])),
        defaultEnv, autoMerge, aiBias, aiProvider, buildCommand: build, testCommand: test,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: j.error || "Could not save." });
    setBusy(null);
    load();
    if (res.ok) onSaved?.();
  };

  const setup = async () => {
    setBusy("setup");
    setMsg(null);
    const res = await fetch(`/api/projects/${projectId}/setup`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: `Setup PR #${j.prNumber} opened. Merge it, then add the ANTHROPIC_API_KEY secret.` } : { ok: false, text: j.error || "Could not open the PR." });
    setBusy(null);
    load();
  };

  const p = data.project;
  const repoUrl = p.repoOwner ? `https://github.com/${p.repoOwner}/${p.repoName}` : null;

  return (
    <div className="mt-3 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-3">
      {repos.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            Install the Idea HQ GitHub App on the repo this project ships to. You choose which repos it can see.
          </p>
          {data.appConfigured ? (
            <a href={returnTo ? `/api/github/install?next=${encodeURIComponent(returnTo)}` : "/api/github/install"}>
              <Button size="sm"><Github className="w-4 h-4 mr-1" /> Connect GitHub</Button>
            </a>
          ) : (
            <p className="text-xs text-amber-600">The GitHub App is not configured on this server yet.</p>
          )}
        </div>
      ) : (
        <>
          <div>
            <Label className="text-xs">Repository</Label>
            <Select value={repoKey} onChange={(e) => setRepoKey(e.target.value)} className="mt-1">
              <option value="">Choose a repo…</option>
              {repos.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              {data.available.map((a) => (
                <a key={a.installationId} href={a.configureUrl || "/api/github/install"} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">
                  Give Idea HQ access to more repos
                </a>
              ))}
              <button type="button" onClick={load} className="text-gray-500 hover:underline">Refresh list</button>
              <a href="/api/github/install?fresh=1" className="text-gray-500 hover:underline">Use another GitHub account</a>
            </div>
            <p className="text-xs text-gray-400 mt-1">Only repos you allowed on GitHub appear here. Add more there, then come back and the list refreshes.</p>
          </div>

          <div>
            <Label className="text-xs">Environments (name → branch the PR targets)</Label>
            <div className="mt-1 space-y-1.5">
              {envs.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="radio" name={`def-${projectId}`} checked={defaultEnv === e.name} onChange={() => setDefaultEnv(e.name)} aria-label="Default" />
                  <Input value={e.name} onChange={(ev) => { const n = [...envs]; if (defaultEnv === e.name) setDefaultEnv(ev.target.value); n[i] = { ...e, name: ev.target.value }; setEnvs(n); }} className="w-28" placeholder="test" />
                  <Input value={e.branch} onChange={(ev) => { const n = [...envs]; n[i] = { ...e, branch: ev.target.value }; setEnvs(n); }} className="flex-1" placeholder="develop" />
                  {envs.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => setEnvs(envs.filter((_, j) => j !== i))} aria-label="Remove"><X className="w-4 h-4" /></Button>
                  )}
                </div>
              ))}
              {envs.length < 5 && (
                <Button variant="ghost" size="sm" onClick={() => setEnvs([...envs, { name: "", branch: "" }])}><Plus className="w-4 h-4 mr-1" /> Environment</Button>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">The selected dot is the default target for new runs.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Build command (optional)</Label>
              <Input value={build} onChange={(e) => setBuild(e.target.value)} placeholder="npm run build" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Test command (optional)</Label>
              <Input value={test} onChange={(e) => setTest(e.target.value)} placeholder="npm test" className="mt-1" />
            </div>
          </div>

          {suggestions && (suggestions.build || suggestions.test) && (!build || !test) && (
            <p className="text-xs text-gray-500">
              Suggested from this repo: {[suggestions.build, suggestions.test].filter(Boolean).join(" · ")}{" "}
              <button type="button" className="text-emerald-600 hover:underline" onClick={() => { if (!build && suggestions.build) setBuild(suggestions.build); if (!test && suggestions.test) setTest(suggestions.test); }}>
                Use them
              </button>
            </p>
          )}

          {(data.providers?.length ?? 0) > 1 && (
            <div>
              <Label className="text-xs">Which AI builds the changes</Label>
              <Select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} className="mt-1">
                {data.providers!.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </Select>
              <p className="text-xs text-gray-400 mt-1">Each one needs its own API key in the repo ({data.providers!.find((x) => x.id === aiProvider)?.secretName}). Switching is instant, no new setup pull request.</p>
            </div>
          )}

          <div>
            <Label className="text-xs">AI model choice</Label>
            <Select value={aiBias} onChange={(e) => setAiBias(e.target.value)} className="mt-1">
              <option value="auto">Automatic: match the model to the size of each idea (recommended)</option>
              <option value="saver">Save money: one tier cheaper than automatic</option>
              <option value="max">Best quality: one tier stronger than automatic</option>
            </Select>
            <p className="text-xs text-gray-400 mt-1">You can still change the model and effort on every run before approving it.</p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} className="mt-1" />
            <span>
              Auto-merge when all checks are green
              <span className="block text-xs text-gray-400">
                Only merges if the base branch is protected on GitHub and the build and tests passed. Leave off for projects with live users unless you trust your checks.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={!repoKey || busy !== null}>
              {busy === "save" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save
            </Button>
            {showSetup && p.repoOwner && !p.workflowInstalled && (
              <Button size="sm" variant="outline" onClick={setup} disabled={busy !== null}>
                {busy === "setup" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}{p.workflowOutdated ? "Update workflow" : "Open setup PR"}
              </Button>
            )}
            {showSetup && p.repoOwner && !p.workflowInstalled && (
              <Button size="sm" variant="ghost" onClick={async () => {
                setBusy("check");
                await load();
                setBusy(null);
                setMsg({ ok: false, text: p.setupPrNumber ? `Not installed yet. Merge setup PR #${p.setupPrNumber} on GitHub first, then check again.` : "Not installed yet. Open the setup PR first." });
              }} disabled={busy !== null}>
                {busy === "check" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Check again
              </Button>
            )}
          </div>

          {showSetup && p.repoOwner && (
            <p className="text-xs text-gray-500">
              {p.workflowInstalled ? "Workflow installed." : p.workflowOutdated ? "Workflow is outdated: update it to keep running." : "Workflow not installed yet."}{" "}
              {repoUrl && <a href={repoUrl} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">{p.repoOwner}/{p.repoName}</a>}
              {!p.workflowInstalled && p.setupPrNumber && repoUrl ? (
                <> · <a href={`${repoUrl}/pull/${p.setupPrNumber}`} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">open setup PR #{p.setupPrNumber}</a></>
              ) : null}
            </p>
          )}
          {showSetup && p.workflowInstalled && (
            <p className="text-xs text-gray-400">
              Runs use the ANTHROPIC_API_KEY secret in the repo (Settings, Secrets and variables, Actions). Idea HQ never sees it.
            </p>
          )}
          {showSetup && p.repoOwner && p.repoPublic && (
            <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              {PUBLIC_REPO_NOTICE}
            </p>
          )}
        </>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
