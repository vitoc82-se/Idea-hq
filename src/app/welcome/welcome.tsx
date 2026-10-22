"use client";

import { AccountData } from "@/components/account-data";
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
import { BacklogImport } from "@/components/backlog-import";
import { Select } from "@/components/ui/select";
import { PRACTICE_TITLE } from "@/lib/runs/practice";
import { effectiveSize } from "@/lib/runs/size";

type Step = { id: string; title: string; status: "done" | "todo" | "blocked" | "warn"; phase: string; detail?: string };
type Onboarding = {
  approved: boolean; steps: Step[]; done: number; total: number; currentId: string | null;
  projectId: string | null; projectName: string | null;
  idea: { id: string; title: string; plan: string | null; complexity: string | null } | null;
  ideas: { id: string; title: string; plan: string | null; complexity: string | null }[];
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

// Waiting for approval: ask them to confirm their email (the owner is warned about unconfirmed addresses).
function ConfirmEmail() {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    const check = () => fetch("/api/auth/verification", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => j && setVerified(!!j.verified)).catch(() => {});
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);
  if (verified !== false) return null;
  const send = async () => {
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/auth/verification", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "The email could not be sent. Try again in a few minutes.");
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError("Could not reach Idea HQ. Check your connection and try again.");
      setState("idle");
    }
  };
  return (
    <div role="status" className="rounded-lg border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-semibold">Confirm your email</p>
      <p className="mt-1">We sent you an email with a link. Open it and press the button, so the owner knows the address is really yours. Check your spam folder too.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={send} disabled={state !== "idle"}>
          {state === "sending" ? "Sending…" : state === "sent" ? "Sent again" : "Send the email again"}
        </Button>
        {error && <span role="alert" className="text-red-800 dark:text-red-300">{error}</span>}
      </div>
    </div>
  );
}

export function Welcome({ name }: { name: string }) {
  const router = useRouter();
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [projectName, setProjectName] = useState("");
  const [drafted, setDrafted] = useState<{ sections: { id: string; text: string }[]; read: { files: string[] } } | null>(null);
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaNotes, setIdeaNotes] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [importSkipped, setImportSkipped] = useState(false);
  const [imported, setImported] = useState<number | null>(null);

  // Remember "no, I will start fresh" per project, so the question is not asked again.
  useEffect(() => {
    if (!ob?.projectId) return;
    try { setImportSkipped(localStorage.getItem(`ihq-import-skip-${ob.projectId}`) === "1"); } catch { /* private mode */ }
  }, [ob?.projectId]);
  const skipImport = () => {
    setImportSkipped(true);
    try { if (ob?.projectId) localStorage.setItem(`ihq-import-skip-${ob.projectId}`, "1"); } catch { /* private mode */ }
  };

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

  const post = async (label: string, url: string, body?: unknown, method = "POST") => {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j.error || "That step did not finish. Try again in a moment." }); return null; }
      return j;
    } finally { setBusy(null); }
  };

  const skip = async () => { await post("skip", "/api/onboarding/dismiss"); router.push("/ideas"); };
  const finish = async () => { await post("finish", "/api/onboarding/dismiss"); router.push("/ideas"); };

  if (!ob) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-600" /></div>;

  const st = (id: string) => ob.steps.find((s) => s.id === id)!.status;
  // Which idea the first AI change is about: the user's pick, else the default.
  const cur = (chosenId && ob.ideas.find((i) => i.id === chosenId)) || ob.idea;
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
    if (j) { setDrafted({ sections: j.sections, read: j.read }); load(); }
  };
  const confirmContext = async () => {
    if (!ob.projectId) return;
    const j = await post("ctx", `/api/projects/${ob.projectId}/knowledge`, { confirmAll: true }, "PATCH");
    if (j) { setMsg({ ok: true, text: "Saved." }); load(); }
  };
  const createIdea = async () => {
    if (!ob.projectId) return;
    const j = await post("idea", "/api/ideas", { projectId: ob.projectId, title: ideaTitle, notes: ideaNotes });
    if (j) { setIdeaTitle(""); setIdeaNotes(""); load(); }
  };
  const estimate = async () => {
    if (!cur) return;
    const j = await post("estimate", `/api/ideas/${cur.id}/estimate`);
    if (j) load();
  };
  const makePlan = async () => {
    if (!cur) return;
    const j = await post("plan", `/api/ideas/${cur.id}/plan`);
    if (j) load();
  };

  return (
    <div className="nb-skin nb-grid min-h-screen bg-gray-50 dark:bg-slate-900">
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
          <>
          <PhaseCard n={1} title="Waiting for approval" status="current">
            <p className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" />
              Your account is created. The owner of this Idea HQ has to approve it before you can start. This page continues by itself the moment you are approved, so you can leave it open or come back later.
            </p>
            <ConfirmEmail />
          </PhaseCard>
          <AccountData />
          </>
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
              {st("context") === "blocked" && !drafted ? (
                <p className="text-sm text-gray-500">Finish connecting your repo first.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    The AI reads this before every estimate and every change, so it builds things that fit your project. Let it read your repo and describe it, then correct anything it got wrong.
                  </p>
                  <Button size="sm" variant="outline" onClick={draftContext} disabled={busy !== null}>
                    {busy === "draft" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}{drafted || ob.contextLength > 0 ? "Read my repo again" : "Read my repo and describe it"}
                  </Button>
                  {drafted && (
                    <div className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                      <p className="text-xs text-gray-500">It read {drafted.read.files.length} files ({drafted.read.files.slice(0, 6).join(", ")}{drafted.read.files.length > 6 ? ", …" : ""}). Here is what it understood:</p>
                      {drafted.sections.filter((x) => x.text).map((x) => (
                        <div key={x.id}>
                          <p className="text-xs font-medium text-gray-500">{({ what: "What it is", stack: "Technology", structure: "How it is organised", run: "How to run, test and ship", rules: "Rules", gotchas: "Quirks" } as Record<string, string>)[x.id] || x.id}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{x.text}</p>
                        </div>
                      ))}
                      {drafted.sections.every((x) => !x.text) && <p className="text-sm text-gray-500">It could not tell much from the files. You can add details on the knowledge page.</p>}
                    </div>
                  )}
                  {(drafted || ob.contextLength > 0) && ob.projectId && (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button size="sm" onClick={confirmContext} disabled={busy !== null}>This looks right</Button>
                      <Link href={`/projects/${ob.projectId}/knowledge`} target="_blank" className="text-sm text-emerald-600 hover:underline">Fix or add details (opens the knowledge page)</Link>
                    </div>
                  )}
                </div>
              )}
            </PhaseCard>

            {ob.projectId && st("project") === "done" && (
              <Card>
                <CardContent className="p-5 space-y-3">
                  <h2 className="font-semibold text-gray-900 dark:text-white">Do you already have a list of ideas? <span className="text-sm font-normal text-gray-500">(optional)</span></h2>
                  {importSkipped && imported === null ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      No problem. You can import a TODO.md or any list later: Projects, then <b>Import ideas</b>.{" "}
                      <button type="button" className="text-emerald-700 underline dark:text-emerald-400" onClick={() => setImportSkipped(false)}>Import one now</button>
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Maybe a TODO.md in your repo, a Notion page, a Trello board or just a note on your phone. Bring it here and the AI turns it into ideas you can rank, estimate and build. You choose what to import first.
                      </p>
                      <BacklogImport projectId={ob.projectId} onImported={(n) => { setImported(n); load(); }} onSkip={skipImport} />
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            <PhaseCard n={5} title="Your first AI change" status={phaseOf("Your first AI change")}>
              {st("idea") === "blocked" ? (
                <p className="text-sm text-gray-500">Teach the AI about your project first.</p>
              ) : !cur ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Write an idea in plain words, or start with a tiny practice one.</p>
                  <div><Label className="text-xs">Idea</Label><Input value={ideaTitle} onChange={(e) => setIdeaTitle(e.target.value)} className="mt-1" placeholder="Show the app version in the footer" /></div>
                  <div><Label className="text-xs">Details (optional)</Label><Textarea value={ideaNotes} onChange={(e) => setIdeaNotes(e.target.value)} className="mt-1 min-h-[80px] text-sm" /></div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={createIdea} disabled={!ideaTitle.trim() || busy !== null}>Add idea</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setIdeaTitle(PRACTICE_TITLE); setIdeaNotes("Add one short line at the end of the README saying this repo is set up for AI implementation with Idea HQ. Change nothing else."); }}>Use a practice idea</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {ob.ideas.length > 1 ? (
                    <div className="space-y-1">
                      <Label htmlFor="first-idea" className="text-xs">Pick the idea to build first. A small one works best.</Label>
                      <Select id="first-idea" value={cur.id} onChange={(e) => setChosenId(e.target.value)}>
                        {ob.ideas.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
                      </Select>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-200">Idea: <b>{cur.title}</b></p>
                  )}
                  {!cur.plan ? (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-600 dark:text-gray-300">Next the AI writes a build prompt: a precise plan for this idea, using your project context. You read and approve it before anything runs.</p>
                      <Button size="sm" onClick={makePlan} disabled={busy !== null}>
                        {busy === "plan" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Generate the build prompt
                      </Button>
                    </div>
                  ) : (
                    <>
                      <details className="text-sm"><summary className="cursor-pointer text-gray-600 dark:text-gray-300">Read the build prompt</summary>
                        <pre className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 whitespace-pre-wrap font-sans text-sm max-h-72 overflow-auto">{cur.plan}</pre>
                      </details>
                      <RunPanel key={cur.id} ideaId={cur.id} projectId={ob.projectId!} plan={cur.plan} sized={!!effectiveSize(cur)} size={effectiveSize(cur)} onEstimate={estimate} estimating={busy === "estimate"} />
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
