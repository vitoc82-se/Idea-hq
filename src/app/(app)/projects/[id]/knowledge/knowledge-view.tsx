"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Check, Pin, Trash2, GitPullRequest, ExternalLink, Sparkles, BookOpen, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { knowledgeTone, KNOWLEDGE_TONE_CLASSES } from "@/lib/knowledge";

type Proposal = { text: string; source: string; at: string };
type Section = { id: string; title: string; hint: string; core: boolean; text: string; source: string | null; status: string | null; updatedAt: string | null; proposal?: Proposal | null };
type Mem = { id: string; kind: string; text: string; pinned: boolean; source: string; createdAt: string };
type LearnRun = { id: string; status: string; prNumber: number | null; checksState: string | null; costUsd: number | null; error: string | null; createdAt: string } | null;
type Data = {
  projectName: string;
  aiBuild?: boolean; // false: the owner switched AI build off for this account
  needsPlan?: boolean; // paywall: needs Pro or a runs pack
  capReached?: string | null; // the monthly spending cap is used up
  repo: { owner: string; name: string } | null;
  workflowInstalled: boolean;
  sections: Section[];
  completeness: { filled: number; confirmed: number; total: number; percent: number };
  freshness: { learnedAt: string | null; behind: number | null; stale?: boolean; proposals?: number; notice?: { level: "ok" | "review" | "stale"; text: string } };
  memory: Mem[];
  learnRun: LearnRun;
  exportPr: number | null;
};
type Question = { section: string; question: string; example: string };

const SOURCE: Record<string, string> = {
  "quick-draft": "Drafted from your repo",
  "learn-run": "Learned by the AI in your GitHub",
  you: "Written or confirmed by you",
  imported: "Imported from earlier notes",
};
const KIND: Record<string, string> = { change: "Shipped", lesson: "Lesson", gotcha: "Heads-up", decision: "Decision", user: "Your note" };
const LEARN_STATUS: Record<string, string> = {
  dispatched: "Starting", running: "The AI is reading your project", pr_open: "Done. Review the file it wrote", merged: "Saved in your repo", failed: "Failed", closed: "Closed", cancelled: "Cancelled",
};

export function KnowledgeView({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/knowledge`, { cache: "no-store" });
    if (res.ok) setD(await res.json());
  }, [projectId]);

  useEffect(() => {
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  // Poll only while the AI is learning (each poll is a cheap, cached GitHub check).
  const learning = d?.learnRun && ["dispatched", "running", "pr_open"].includes(d.learnRun.status);
  useEffect(() => {
    if (!learning) return;
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [learning, load]);

  const call = async (label: string, url: string, init?: { method?: string; body?: unknown }) => {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch(url, { method: init?.method || "POST", headers: { "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j.error || "That step did not finish. Try again in a moment." }); return null; }
      return j;
    } finally { setBusy(null); }
  };

  if (!d) return <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />;

  const base = `/api/projects/${projectId}`;
  const quickDraft = async (force = false) => {
    const j = await call("draft", `${base}/context-draft`, { body: { force } });
    if (j) {
      const r = (j.result ?? {}) as { applied?: number; proposed?: number };
      const parts = [`Read ${j.read.files.length} files from your repo.`];
      if (r.applied) parts.push(`Updated ${r.applied} topic${r.applied === 1 ? "" : "s"}.`);
      if (r.proposed) parts.push(`Suggested changes to ${r.proposed} topic${r.proposed === 1 ? "" : "s"} you confirmed: review them below.`);
      if (!r.applied && !r.proposed) parts.push("Nothing new: what you have matches what it could see.");
      setMsg({ ok: true, text: parts.join(" ") });
      load();
    }
  };
  const learn = async () => {
    const j = await call("learn", `${base}/knowledge/learn`);
    if (j) { setMsg({ ok: true, text: "Started. This takes a few minutes. You can leave this page." }); load(); }
  };
  const saveSection = async (id: string) => {
    const j = await call("save", `${base}/knowledge`, { method: "PATCH", body: { section: id, text: draft } });
    if (j) { setEditing(null); load(); }
  };
  const settle = async (id: string, how: "useSuggestion" | "keepMine") => { if (await call(how, `${base}/knowledge`, { method: "PATCH", body: { section: id, [how]: true } })) load(); };
  const confirm = async (id: string) => { if (await call("confirm", `${base}/knowledge`, { method: "PATCH", body: { section: id, confirm: true } })) load(); };
  const confirmAllSections = async () => { if (await call("confirmAll", `${base}/knowledge`, { method: "PATCH", body: { confirmAll: true } })) load(); };
  const interview = async () => {
    const j = await call("questions", `${base}/knowledge/questions`);
    if (j?.questions) { setQuestions(j.questions); setAnswers({}); }
    else if (j?.error) setMsg({ ok: true, text: j.error });
  };
  const sendAnswers = async () => {
    const list = (questions || []).map((q, i) => ({ section: q.section, question: q.question, answer: answers[i] || "" })).filter((a) => a.answer.trim());
    const j = await call("answers", `${base}/knowledge/answers`, { body: { answers: list } });
    if (j) { setQuestions(null); setMsg({ ok: true, text: "Thanks. The knowledge is updated." }); load(); }
  };
  const exportToRepo = async () => {
    const j = await call("export", `${base}/knowledge/export`);
    if (j) { setMsg({ ok: true, text: j.reused ? `Pull request #${j.prNumber} is already open. Merge it on GitHub.` : `Pull request #${j.prNumber} opened. Merge it on GitHub to save a copy in your repo.` }); load(); }
  };
  const addNote = async () => { if (await call("note", `${base}/memory`, { body: { text: note, pinned: true } })) { setNote(""); load(); } };
  const pin = async (m: Mem) => { if (await call("pin", `${base}/memory/${m.id}`, { method: "PATCH", body: { pinned: !m.pinned } })) load(); };
  const del = async (m: Mem) => { if (await call("del", `${base}/memory/${m.id}`, { method: "DELETE" })) load(); };

  const repoUrl = d.repo ? `https://github.com/${d.repo.owner}/${d.repo.name}` : null;
  const lr = d.learnRun;
  const pct = d.completeness.percent;
  const needsReview = d.sections.filter((s) => s.text && s.status === "needs_review").length;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-emerald-600 hover:underline">← Projects</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2 flex items-center gap-2"><BookOpen className="w-6 h-6 text-emerald-600" /> What Idea HQ knows about {projectName || d.projectName}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          The AI reads this before every estimate and plan. The better it is, the better the results. Fix anything that is wrong, and fill in what it could not see.
        </p>
        <div className="mt-3">
          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"><div className={`h-full transition-all ${KNOWLEDGE_TONE_CLASSES[knowledgeTone(pct)].bar}`} style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-gray-500 mt-1">
            {pct}% complete · {d.completeness.filled} of {d.completeness.total} topics filled · {d.completeness.confirmed} confirmed by you
            {d.freshness.learnedAt && <> · learned {formatDistanceToNow(new Date(d.freshness.learnedAt), { addSuffix: true })}</>}
            {d.freshness.behind && !d.freshness.stale ? <span className="text-amber-700 dark:text-amber-300"> · the repo has {d.freshness.behind} newer commit{d.freshness.behind > 1 ? "s" : ""} since</span> : null}
            {d.freshness.notice?.level === "ok" && <span data-testid="compared-note"> · {d.freshness.notice.text.replace(/\.$/, "")}</span>}
          </p>
        </div>
      </div>

      {d.freshness.notice?.level === "review" && (
        <div role="status" data-testid="suggestions-notice" className="rounded-xl border border-amber-600 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold">Suggested changes to review</p>
          <p className="mt-1">{d.freshness.notice.text}</p>
        </div>
      )}

      {d.freshness.stale && d.repo && (
        <div role="status" className="rounded-xl border border-amber-600 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold">Scan this project again?</p>
          <p className="mt-1">
            The repo has {d.freshness.behind} new commits since the AI last learned it{d.freshness.learnedAt ? ` (${formatDistanceToNow(new Date(d.freshness.learnedAt), { addSuffix: true })})` : ""}. Estimates and plans may miss recent changes.
            A quick scan is free and takes seconds. A deep scan explores the whole repo in your GitHub (a few minutes, uses your AI key). A topic you confirmed is never changed by a scan: if the scan finds something different, it shows up here as a suggestion for you to accept or keep your text.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={busy !== null} onClick={() => quickDraft(false)}>
              {busy === "draft" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}Quick scan now
            </Button>
            <Button size="sm" variant="outline" disabled={d.aiBuild === false || !!d.needsPlan || !!d.capReached || !d.workflowInstalled || busy !== null || !!learning} onClick={learn}>Deep scan in my GitHub</Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!d.repo || busy !== null} onClick={() => quickDraft(false)}>
              {busy === "draft" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}Quick draft from my repo
            </Button>
            <Button size="sm" disabled={d.aiBuild === false || !!d.needsPlan || !!d.capReached || !d.repo || !d.workflowInstalled || busy !== null || !!learning} onClick={learn}>
              {busy === "learn" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Learn deeply in my GitHub
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={interview}>
              {busy === "questions" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Answer a few questions
            </Button>
            <Button size="sm" variant="outline" disabled={!d.repo || busy !== null} onClick={exportToRepo}>
              {busy === "export" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save a copy in my repo
            </Button>
            {needsReview > 0 && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={confirmAllSections}>Looks right, confirm all</Button>}
          </div>
          <p className="text-xs text-gray-500">
            <b>Quick draft</b> reads the key files, takes seconds, uses Idea HQ&apos;s AI. <b>Learn deeply</b> lets the AI explore your whole repo inside your own GitHub (about a few minutes, uses your Anthropic key, usually under a dollar). It opens a pull request with what it wrote.
            {d.aiBuild === false && " AI build is switched off for your account. Ask the owner."}{d.aiBuild !== false && d.needsPlan && <> AI build needs Pro or a runs pack. <Link href="/billing" className="font-semibold text-emerald-800 underline dark:text-emerald-300">Open Billing</Link>.</>}{d.capReached && ` ${d.capReached}`}{!d.repo && " Connect a repo first."}{d.repo && !d.workflowInstalled && " Deep learning needs the repo setup finished (the workflow merged)."}
          </p>
          {d.exportPr && repoUrl && (
            <p className="text-sm"><GitPullRequest className="w-4 h-4 inline mr-1" />A copy is waiting in <a className="text-emerald-600 hover:underline" href={`${repoUrl}/pull/${d.exportPr}`} target="_blank" rel="noreferrer">pull request #{d.exportPr} <ExternalLink className="w-3 h-3 inline" /></a>. Merge it to keep it in the repo.</p>
          )}
          {lr && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Deep learning:</span> {LEARN_STATUS[lr.status] || lr.status}
                {learning && <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />}
                {lr.prNumber && repoUrl && <a className="text-emerald-600 hover:underline" href={`${repoUrl}/pull/${lr.prNumber}`} target="_blank" rel="noreferrer">PR #{lr.prNumber} <ExternalLink className="w-3 h-3 inline" /></a>}
                {lr.costUsd != null && <span className="text-xs text-gray-500">${lr.costUsd.toFixed(2)}</span>}
              </p>
              {lr.status === "pr_open" && (
                <div className="flex gap-2 flex-wrap items-center">
                  <span className="text-xs text-gray-500">What it wrote is already shown below, marked &quot;needs review&quot;. Merging saves the file in your repo.</span>
                  <Button size="sm" disabled={busy !== null || lr.checksState !== "green"} onClick={async () => { if (await call("merge", `/api/runs/${lr.id}/merge`)) load(); }}>Merge it</Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={async () => { if (await call("close", `/api/runs/${lr.id}/cancel`)) load(); }}>Skip the repo copy</Button>
                </div>
              )}
              {lr.error && <p className="text-red-600 dark:text-red-400">{lr.error}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {questions && (
        <Card className="border-emerald-500/60">
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-gray-900 dark:text-white">A few quick questions</p>
            <p className="text-xs text-gray-500">Answer in your own words. Skip any you do not know.</p>
            {questions.map((q, i) => (
              <div key={i} className="space-y-1">
                <label className="text-sm text-gray-800 dark:text-gray-200">{q.question}</label>
                <Textarea value={answers[i] || ""} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} className="min-h-[60px] text-sm" placeholder={q.example ? `For example: ${q.example}` : ""} />
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy !== null || !Object.values(answers).some((a) => a.trim())} onClick={sendAnswers}>
                {busy === "answers" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Add to the knowledge
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setQuestions(null)}>Not now</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {d.sections.filter((s) => s.core || s.text).map((s) => (
          <Card key={s.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-gray-900 dark:text-white">{s.title}</h2>
                  {!s.text && <p className="text-xs text-gray-500">{s.hint}</p>}
                </div>
                {s.proposal && <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Suggested change</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${!s.text ? "bg-gray-100 text-gray-500 dark:bg-gray-800" : s.status === "confirmed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                  {!s.text ? "Missing" : s.status === "confirmed" ? "Confirmed" : "Needs review"}
                </span>
              </div>
              {editing === s.id ? (
                <div className="space-y-2">
                  <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[140px] text-sm" />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy !== null} onClick={() => saveSection(s.id)}>{busy === "save" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  {s.text && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{s.text}</p>}
                  {s.proposal && (
                    <div data-testid="suggestion" className="rounded-lg border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                      <p className="font-medium">The scan {formatDistanceToNow(new Date(s.proposal.at), { addSuffix: true })} ({SOURCE[s.proposal.source] || s.proposal.source}) suggests this instead:</p>
                      <p className="mt-1 whitespace-pre-wrap">{s.proposal.text}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" disabled={busy !== null} onClick={() => settle(s.id, "useSuggestion")}>{busy === "useSuggestion" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Use the new text</Button>
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => settle(s.id, "keepMine")}>Keep mine</Button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(s.id); setDraft(s.text); }}><Pencil className="w-3.5 h-3.5 mr-1" />{s.text ? "Edit" : "Write it"}</Button>
                    {s.text && s.status !== "confirmed" && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => confirm(s.id)}><Check className="w-3.5 h-3.5 mr-1" />This is right</Button>}
                    {s.source && <span className="text-xs text-gray-600 dark:text-gray-400">{SOURCE[s.source] || s.source}{s.updatedAt && s.text ? `, last changed ${formatDistanceToNow(new Date(s.updatedAt), { addSuffix: true })}` : ""}</span>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">What Idea HQ has learned while working on this</h2>
            <p className="text-xs text-gray-500">Added automatically after each change: what shipped, what you asked to fix, what failed. Pin the ones that matter. The AI always sees pinned facts and the most recent others.</p>
          </div>
          <div className="flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a rule or fact, e.g. Never change the scoring formula" onKeyDown={(e) => e.key === "Enter" && note.trim() && addNote()} />
            <Button size="sm" disabled={!note.trim() || busy !== null} onClick={addNote}>Add</Button>
          </div>
          {d.memory.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing yet. It fills up as you ship changes.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {d.memory.slice(0, 40).map((m) => (
                <li key={m.id} className="py-2 flex items-start gap-2">
                  <span className="text-xs w-16 shrink-0 text-gray-400 pt-0.5">{KIND[m.kind] || m.kind}</span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">{m.text}</p>
                  <button type="button" title={m.pinned ? "Unpin" : "Pin: always show the AI"} onClick={() => pin(m)} className={m.pinned ? "text-emerald-600" : "text-gray-400 hover:text-emerald-600"}><Pin className="w-4 h-4" /></button>
                  <button type="button" title="Forget this" onClick={() => del(m)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
