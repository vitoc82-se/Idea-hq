"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Rocket, Check, Loader2, PartyPopper, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SetupJourney } from "@/app/(app)/projects/[id]/setup/setup-journey";
import { RunPanel } from "@/app/(app)/ideas/run-panel";

type Step = { id: string; title: string; status: "done" | "todo" | "blocked" | "warn"; phase: string; detail?: string };
type Onboarding = {
  approved: boolean; steps: Step[]; done: number; total: number; currentId: string | null;
  projectId: string | null; projectName: string | null;
  idea: { id: string; title: string; plan: string | null } | null;
  contextLength: number; shipped: boolean;
};

const PHASES = ["Welcome", "Connect your repo", "Teach the AI", "Your first AI change"];

function PhaseCard({ n, title, status, children }: { n: number; title: string; status: "done" | "current" | "later"; children?: React.ReactNode }) {
  return (
    <Card className={status === "current" ? "border-emerald-500/60" : status === "later" ? "opacity-60" : ""}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium ${status === "done" ? "bg-emerald-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"}`}>
            {status === "done" ? <Check className="w-4 h-4" /> : n}
          </span>
          <h2 className="font-semibold text-gray-900 dark:text-white">{title}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function Welcome({ name }: { name: string }) {
  const router = useRouter();
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [projectName, setProjectName] = useState("");
  const [context, setContext] = useState("");
  const [ctxTouched, setCtxTouched] = useState(false);
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaNotes, setIdeaNotes] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/onboarding", { cache: "no-store" });
    if (res.ok) setOb(await res.json());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // Pull the saved project context into the editor once (and never overwrite typing).
  useEffect(() => {
    if (!ob?.projectId || ctxTouched || !ob.approved) return;
    fetch("/api/projects", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) return;
      const list: { id: string; context: string }[] = await r.json();
      const p = list.find((x) => x.id === ob.projectId);
      if (p && !ctxTouched) setContext(p.context || "");
    });
  }, [ob?.projectId, ob?.approved, ctxTouched]);

  const post = async (label: string, url: string, body?: unknown, method = "POST") => {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j.error || "Something went wrong." }); return null; }
      return j;
    } finally { setBusy(null); }
  };

  const skip = async () => { await post("skip", "/api/onboarding/dismiss"); router.push("/ideas"); };
  const finish = async () => { await post("finish", "/api/onboarding/dismiss"); router.push("/ideas"); };

  if (!ob) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-600" /></div>;

  const st = (id: string) => ob.steps.find((s) => s.id === id)!.status;
  const phaseDone = (phase: string) => ob.steps.filter((s) => s.phase === phase).every((s) => s.status === "done");
  const phaseOf = (phase: string): "done" | "current" | "later" =>
    phaseDone(phase) ? "done" : PHASES.slice(0, PHASES.indexOf(phase)).every(phaseDone) ? "current" : "later";

  const createProject = async () => {
    const j = await post("project", "/api/projects", { name: projectName });
    if (j) { setProjectName(""); load(); }
  };
  const draftContext = async () => {
    if (!ob.projectId) return;
    const j = await post("draft", `/api/projects/${ob.projectId}/context-draft`);
    if (j?.context) { setCtxTouched(true); setContext(j.context); }
  };
  const saveContext = async () => {
    if (!ob.projectId) return;
    const j = await post("ctx", `/api/projects/${ob.projectId}`, { context }, "PATCH");
    if (j) { setMsg({ ok: true, text: "Saved." }); load(); }
  };
  const createIdea = async () => {
    if (!ob.projectId) return;
    const j = await post("idea", "/api/ideas", { projectId: ob.projectId, title: ideaTitle, notes: ideaNotes });
    if (j) { setIdeaTitle(""); setIdeaNotes(""); load(); }
  };
  const makePlan = async () => {
    if (!ob.idea) return;
    const j = await post("plan", `/api/ideas/${ob.idea.id}/plan`);
    if (j) load();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center"><Rocket className="w-5 h-5 text-white" /></div>
            <span className="text-lg font-bold text-gray-900 dark:text-white">Idea HQ</span>
          </div>
          <div className="flex gap-2 items-center">
            <Link href="/guide" target="_blank" className="text-sm text-gray-600 dark:text-gray-300 hover:text-emerald-600 px-2">Guide</Link>
            {ob.approved && <Button variant="ghost" size="sm" onClick={skip} disabled={busy !== null}>Skip for now</Button>}
            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>Sign out</Button>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{name ? `Welcome, ${name.split(" ")[0]}` : "Welcome"}</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1 text-sm">
            Idea HQ keeps your ideas for all your projects in one place, estimates them, and can have an AI implement one as a pull request in your GitHub repo.
            You review and merge every change. This takes about 10 minutes and ends with your first AI-built change. New to this? The <Link href="/guide" target="_blank" className="text-emerald-600 hover:underline">guide</Link> explains every step in plain language.
          </p>
          {ob.approved && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(ob.done / ob.total) * 100}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{ob.done} of {ob.total} steps done</p>
            </div>
          )}
        </div>

        {!ob.approved ? (
          <PhaseCard n={1} title="Waiting for approval" status="current">
            <p className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" />
              Your account is created. The owner of this Idea HQ has to approve it before you can start. You don&apos;t need to do anything else. This page continues by itself the moment you are approved, so you can leave it open or come back later.
            </p>
          </PhaseCard>
        ) : (
          <>
            <PhaseCard n={1} title="Create your first project" status={st("project") === "done" ? "done" : "current"}>
              {st("project") === "done" ? (
                <p className="text-sm text-gray-500">Project: <b>{ob.projectName}</b></p>
              ) : (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-300">A project is one product or codebase, for example &quot;My webshop&quot;. Ideas, estimates and AI changes all belong to a project.</p>
                  <div className="flex gap-2">
                    <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" />
                    <Button onClick={createProject} disabled={!projectName.trim() || busy !== null}>
                      {busy === "project" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
                    </Button>
                  </div>
                </>
              )}
            </PhaseCard>

            <PhaseCard n={2} title="Connect your repo" status={st("project") !== "done" ? "later" : phaseOf("Connect your repo")}>
              {ob.projectId && st("project") === "done" && (
                <SetupJourney projectId={ob.projectId} projectName={ob.projectName || ""} embedded returnTo="/welcome" onStatus={() => load()} />
              )}
            </PhaseCard>

            <PhaseCard n={3} title="Teach the AI about your project" status={phaseOf("Teach the AI")}>
              {st("context") === "blocked" ? (
                <p className="text-sm text-gray-500">Finish connecting your repo first.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    The AI reads this before every estimate and every change, so it builds things that fit your project. Let it read your repo and draft this, then fix anything it got wrong.
                  </p>
                  <Button size="sm" variant="outline" onClick={draftContext} disabled={busy !== null}>
                    {busy === "draft" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Draft it from my repo
                  </Button>
                  <Textarea value={context} onChange={(e) => { setCtxTouched(true); setContext(e.target.value); }} className="min-h-[200px] text-xs font-mono"
                    placeholder="What the project is, its stack, the important folders, and how it is built and tested." />
                  <Button size="sm" onClick={saveContext} disabled={busy !== null || context.trim().length < 120}>
                    {busy === "ctx" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save
                  </Button>
                  {context.trim().length < 120 && <p className="text-xs text-gray-400">At least a few sentences, so the AI has something to go on.</p>}
                </div>
              )}
            </PhaseCard>

            <PhaseCard n={4} title="Your first AI change" status={phaseOf("Your first AI change")}>
              {st("idea") === "blocked" ? (
                <p className="text-sm text-gray-500">Teach the AI about your project first.</p>
              ) : !ob.idea ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Write an idea in plain words, or start with a tiny practice one.</p>
                  <div><Label className="text-xs">Idea</Label><Input value={ideaTitle} onChange={(e) => setIdeaTitle(e.target.value)} className="mt-1" placeholder="Show the app version in the footer" /></div>
                  <div><Label className="text-xs">Details (optional)</Label><Textarea value={ideaNotes} onChange={(e) => setIdeaNotes(e.target.value)} className="mt-1 min-h-[80px] text-sm" /></div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={createIdea} disabled={!ideaTitle.trim() || busy !== null}>Add idea</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setIdeaTitle("Practice: add a one-line note to the README"); setIdeaNotes("Add one short line at the end of the README saying this repo is set up for AI implementation with Idea HQ. Change nothing else."); }}>Use a practice idea</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700 dark:text-gray-200">Idea: <b>{ob.idea.title}</b></p>
                  {!ob.idea.plan ? (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-600 dark:text-gray-300">Next the AI writes a build prompt: a precise plan for this idea, using your project context. You read and approve it before anything runs.</p>
                      <Button size="sm" onClick={makePlan} disabled={busy !== null}>
                        {busy === "plan" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Generate the build prompt
                      </Button>
                    </div>
                  ) : (
                    <>
                      <details className="text-sm"><summary className="cursor-pointer text-gray-600 dark:text-gray-300">Read the build prompt</summary>
                        <pre className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 whitespace-pre-wrap font-sans text-sm max-h-72 overflow-auto">{ob.idea.plan}</pre>
                      </details>
                      <RunPanel ideaId={ob.idea.id} projectId={ob.projectId!} plan={ob.idea.plan} />
                    </>
                  )}
                </div>
              )}
            </PhaseCard>

            {ob.shipped && (
              <Card className="border-emerald-500/60">
                <CardContent className="p-5 space-y-3">
                  <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><PartyPopper className="w-5 h-5 text-emerald-600" /> You shipped your first AI change</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300">From here, the loop is: add an idea, let the AI estimate it, generate the build prompt, implement, review, merge. Each project has its own setup guide, and you can connect more projects any time.</p>
                  <Button onClick={finish} disabled={busy !== null}>Go to my ideas</Button>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
