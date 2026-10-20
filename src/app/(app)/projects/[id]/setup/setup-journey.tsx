"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Circle, Lock, AlertTriangle, Loader2, Copy, ExternalLink, Rocket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProjectRepo } from "../../project-repo";
import { KeyRelay } from "../../key-relay";

type Step = { id: string; title: string; status: "done" | "todo" | "blocked" | "warn"; detail?: string; url?: string };
type Status = {
  steps: Step[]; done: number; total: number; currentId: string | null;
  repo: { owner: string; name: string } | null;
  suggestions: { build: string | null; test: string | null };
  otherRepos: string[];
  provider: { id: string; label: string; secretName: string; keyHelpUrl: string; keyHelpText: string };
  siblings: { id: string; name: string; repo: string; provider: string }[];
  workflowUpdateAvailable?: boolean;
  updatePrUrl?: string | null;
};

const WHY: Record<string, string> = {
  github: "Idea HQ works through a GitHub App. You choose which repos it may see, and you can change that any time.",
  repo: "Pick the repo this project ships to, and the branch each pull request should target (for example live → main).",
  commands: "After the AI changes code, these commands decide if the change is safe: a type-check or build, and your tests. Empty is allowed, but then nothing verifies the work.",
  workflow: "A small file in your repo that lets GitHub run the AI for you, with a 30 minute and 40 turn cap. Idea HQ opens a pull request for it. You review and merge it once.",
  secret: "The AI runs in your own GitHub Actions, so it needs your own API key from the AI company you chose. You can paste it here once and Idea HQ saves it in your repo as a secret and forgets it, or add it by hand.",
  practice: "Run one tiny idea end to end before real work, so you know what a run looks like and what it costs (usually 15 to 40 cents).",
};

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 p-2">
      <code className="text-xs break-all flex-1 text-gray-700 dark:text-gray-200">{text}</code>
      <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        <Copy className="w-4 h-4 mr-1" />{copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function SetupJourney({
  projectId,
  projectName,
  embedded = false,
  returnTo,
  onStatus,
}: {
  projectId: string;
  projectName: string;
  embedded?: boolean; // inside the welcome journey: no header, no practice step
  returnTo?: string; // where GitHub sends the user back to
  onStatus?: (s: Status) => void;
}) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [ideaId, setIdeaId] = useState<string | null>(null);
  const [canRelay, setCanRelay] = useState<boolean | null>(null);
  const [relayReason, setRelayReason] = useState<string | null>(null);

  const [limited, setLimited] = useState<string | null>(null);
  const pausedUntil = useRef(0);

  // Three kinds of check, from free to costly:
  //  quick: our own database only, no GitHub requests (safe to poll often)
  //  full:  asks GitHub, shared 30s cache on the server
  //  fresh: asks GitHub now (the "Check again" button)
  const load = useCallback(async (mode: "quick" | "full" | "fresh" = "full") => {
    if (mode !== "quick" && Date.now() < pausedUntil.current) mode = "quick"; // backing off
    const qs = mode === "quick" ? "?quick=1" : mode === "fresh" ? "?fresh=1" : "";
    const res = await fetch(`/api/projects/${projectId}/setup-status${qs}`, { cache: "no-store" });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      pausedUntil.current = Date.now() + (Number(j.retryAfterSec) || 60) * 1000;
      setLimited(j.error || "GitHub is limiting requests. Trying again shortly.");
      return;
    }
    if (res.ok) {
      const j: Status = await res.json();
      setLimited(null);
      setSt(j);
      onStatus?.(j);
    }
  }, [projectId, onStatus]);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/relay-capability`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setCanRelay(j ? !!j.canWrite : false);
        setRelayReason(j?.reason ?? (j ? null : "check_failed"));
      })
      .catch(() => {
        setCanRelay(false);
        setRelayReason("check_failed");
      });
  }, [projectId]);

  const waitingOnGitHub = st?.currentId === "workflow" || st?.currentId === "secret";
  const waitingRef = useRef(false);
  waitingRef.current = !!waitingOnGitHub;

  useEffect(() => {
    load("full");
    // Free checks every 8s; a real GitHub check only every 60s, and only while
    // we are waiting for the user to do something on GitHub.
    let tick = 0;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      tick += 1;
      if (waitingRef.current && tick % 8 === 0) load("full");
      else load("quick");
    }, 8000);
    const onVis = () => document.visibilityState === "visible" && load("full");
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  if (!st) return <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />;

  const stepOf = (id: string) => st.steps.find((s) => s.id === id)!;
  const formStep = ["repo", "commands"].find((id) => stepOf(id).status !== "done") || null;

  const openPr = async () => {
    setBusy("pr"); setMsg(null);
    const res = await fetch(`/api/projects/${projectId}/setup`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok
      ? { ok: true, text: `Pull request #${j.prNumber} is open. Merge it on GitHub, this page updates by itself.`, url: st.repo ? `https://github.com/${st.repo.owner}/${st.repo.name}/pull/${j.prNumber}` : undefined }
      : { ok: false, text: j.error || "Could not open the PR." });
    setBusy(null); load("fresh");
  };

  const practice = async () => {
    setBusy("practice"); setMsg(null);
    const res = await fetch("/api/ideas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId, title: "Practice: add a one-line note to the README",
        notes: "Practice run for Idea HQ. Add one short line at the end of the README that says this repo is set up for AI implementation with Idea HQ. Change nothing else.",
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) setIdeaId(j.id); else setMsg({ ok: false, text: j.error || "Could not create the idea." });
    setBusy(null);
  };

  const allRepos = st.repo ? [`${st.repo.owner}/${st.repo.name}`, ...st.otherRepos.filter((r) => r !== `${st.repo!.owner}/${st.repo!.name}`)] : [];
  const multiCmd = `read -s -p "API key: " KEY; echo; for r in ${allRepos.join(" ")}; do gh secret set ${st.provider.secretName} --repo "$r" --body "$KEY"; done; unset KEY`;

  const Icon = ({ s }: { s: Step["status"] }) =>
    s === "done" ? <Check className="w-5 h-5 text-emerald-600" /> : s === "warn" ? <AlertTriangle className="w-5 h-5 text-amber-500" /> : s === "blocked" ? <Lock className="w-4 h-4 text-gray-400" /> : <Circle className="w-5 h-5 text-emerald-600" />;

  return (
    <div className="max-w-2xl space-y-5">
      {!embedded && <div>
        <Link href="/projects" className="text-sm text-emerald-600 hover:underline">← Projects</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">Set up {projectName} for AI implementation</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          {st.done === st.total ? "All set. Implement any idea in this project." : `${st.done} of ${st.total} done. This page updates by itself as you finish things on GitHub.`}
        </p>
        <div className="h-2 mt-3 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(st.done / st.total) * 100}%` }} />
        </div>
      </div>}

      {st.workflowUpdateAvailable && (
        <div role="status" className="rounded-xl border border-amber-600 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold">A newer workflow is available</p>
          <p className="mt-1">The one in your repo still works. The newer one also keeps going when your lock file is out of sync, and passes the AI&apos;s final message back, so you can see why a run changed nothing. Updating opens a pull request that you merge.</p>
          {st.updatePrUrl ? (
            <p className="mt-3">
              The update is waiting for you on GitHub.{" "}
              <a href={st.updatePrUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open the pull request and merge it</a>. This page updates by itself.
            </p>
          ) : (
            <Button size="sm" className="mt-3 bg-emerald-700 hover:bg-emerald-800" onClick={openPr} disabled={busy !== null}>
              {busy === "pr" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Update the workflow
            </Button>
          )}
        </div>
      )}

      {st.steps.filter((x) => !(embedded && x.id === "practice")).map((s, i) => {
        const current = st.currentId === s.id;
        const open = current || (formStep === s.id);
        return (
          <Card key={s.id} className={current ? "border-emerald-500/60" : ""}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5"><Icon s={s.status} /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white">{i + 1}. {s.title}</p>
                  {s.detail && <p className="text-sm text-gray-500 dark:text-gray-400">{s.detail}</p>}
                </div>
                {s.status === "done" && <span className="text-xs text-emerald-600">Done</span>}
              </div>

              {open && s.status !== "done" && s.status !== "blocked" && (
                <div className="pl-8 space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300">{WHY[s.id]}</p>

                  {s.id === "github" && (
                    <a href={`/api/github/install?next=${encodeURIComponent(returnTo || `/projects/${projectId}/setup`)}`}>
                      <Button size="sm">Connect GitHub</Button>
                    </a>
                  )}

                  {(s.id === "repo" || s.id === "commands") && formStep === s.id && (
                    <ProjectRepo projectId={projectId} showSetup={false} suggestions={st.suggestions} onSaved={load} returnTo={returnTo || `/projects/${projectId}/setup`} />
                  )}

                  {s.id === "workflow" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={openPr} disabled={busy !== null}>
                        {busy === "pr" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                        {s.status === "warn" ? "Update workflow" : s.detail ? "Reopen setup PR link" : "Open the pull request"}
                      </Button>
                      {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-sm text-emerald-600 hover:underline inline-flex items-center gap-1">View on GitHub <ExternalLink className="w-3 h-3" /></a>}
                    </div>
                  )}

                  {s.id === "secret" && (
                    <div className="space-y-3">
                      {canRelay ? (
                        <KeyRelay projectId={projectId} provider={st.provider} siblings={st.siblings} onDone={() => load("fresh")} />
                      ) : (
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {relayReason === "no_repo"
                            ? "Connect this project to its GitHub repo first (the repo step above). Then you can paste the key here."
                            : relayReason === "permission"
                            ? "Your GitHub installation of Idea HQ cannot save secrets yet. In GitHub, open Settings, Applications, Installed GitHub Apps, Idea HQ, and approve the updated permissions. Until then, add the key by hand below."
                            : canRelay === null
                            ? "Checking whether Idea HQ can save the key for you…"
                            : "Could not check with GitHub just now. Reload the page to try again, or add the key by hand below."}
                        </p>
                      )}
                      <details className="text-sm" open={!canRelay}>
                        <summary className="cursor-pointer text-gray-600 dark:text-gray-300">Prefer to add it by hand on GitHub?</summary>
                        <div className="mt-2 space-y-2">
                          <ol className="text-sm text-gray-600 dark:text-gray-300 list-decimal pl-5 space-y-1">
                            <li>Open the secret page on GitHub (button below). It must be a <b>Secret</b>, on the &quot;Secrets&quot; tab. Do not use the &quot;Variables&quot; tab: variables are shown in plain text and are not safe for a key.</li>
                            <li>Name: <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">{st.provider.secretName}</code></li>
                            <li>Secret: your key from {st.provider.keyHelpText}. Use one with a small spending limit.</li>
                            <li>Click Add secret, then come back. This page notices.</li>
                          </ol>
                          {s.url && <a href={s.url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline">Open the secret page <ExternalLink className="w-3 h-3 ml-1" /></Button></a>}
                          {allRepos.length > 1 && (
                            <div>
                              <p className="text-xs text-gray-500 my-2">Several repos? With the GitHub CLI (<code>gh</code>) signed in, paste your key when asked (it stays hidden). A personal GitHub account has no shared secrets, so each repo gets its own copy.</p>
                              <CopyBox text={multiCmd} />
                            </div>
                          )}
                        </div>
                      </details>
                    </div>
                  )}

                  {s.id === "practice" && (
                    <div className="space-y-2">
                      {!ideaId ? (
                        <Button size="sm" onClick={practice} disabled={busy !== null}>
                          {busy === "practice" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Rocket className="w-4 h-4 mr-1" />}Create the practice idea
                        </Button>
                      ) : (
                        <div className="text-sm space-y-1">
                          <p className="text-gray-600 dark:text-gray-300">Created. On the idea page: <b>Generate build prompt</b>, then <b>Implement</b>, then <b>Approve and run</b>.</p>
                          <Link href={`/ideas/${ideaId}`} className="text-emerald-600 hover:underline">Open the practice idea →</Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {limited && <p className="text-sm text-amber-600 dark:text-amber-400">{limited}</p>}
      {msg && (
        <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.text}{" "}
          {msg.url && <a href={msg.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open the pull request on GitHub</a>}
        </p>
      )}
      <Button size="sm" variant="ghost" onClick={() => load("fresh")}>Check again</Button>
    </div>
  );
}
