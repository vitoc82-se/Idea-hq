"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Loader2, Trash2, Check, Circle, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { OWNER_STATUS_LABEL, STATUSES, type TicketStatus } from "@/lib/support/constants";

type Item = {
  id: string; number: number; status: TicketStatus; subject: string; customerEmail: string; customerName: string | null;
  aiAnswered: boolean; unread: boolean; lastActivityAt: string; projectId: string; projectName: string;
};
type Proj = { id: string; name: string; supportOn: boolean; setup: { formChosen: boolean; notesReviewed: boolean; siteAdded: boolean } };
type Msg = { id: string; author: "customer" | "owner" | "ai"; body: string; createdAt: string; emailedAt: string | null };
type Detail = {
  id: string; number: number; status: TicketStatus; subject: string; customerEmail: string; customerName: string | null;
  fields: { id: string; label: string; value: string }[]; aiAnswered: boolean; projectName: string; messages: Msg[];
};

const FILTERS = [
  { id: "needs", label: "Needs a person" },
  { id: "waiting", label: "Waiting for customer" },
  { id: "ai", label: "AI answered" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
] as const;

const AiTag = () => (
  <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">AI answer</span>
);

export function Inbox() {
  const [filter, setFilter] = useState<string>("needs");
  const [project, setProject] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [projects, setProjects] = useState<Proj[]>([]);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string; retry?: boolean } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const loadList = useCallback(async () => {
    const q = new URLSearchParams({ filter });
    if (project) q.set("project", project);
    const res = await fetch(`/api/tickets?${q}`, { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load tickets.");
      return;
    }
    const d = await res.json();
    setError("");
    setItems(d.tickets);
    setProjects(d.projects);
  }, [filter, project]);

  useEffect(() => {
    setItems(null);
    loadList();
    const t = setInterval(loadList, 45000);
    return () => clearInterval(t);
  }, [loadList]);

  const open = useCallback(async (id: string) => {
    setOpenId(id);
    setDetailLoading(true);
    setBanner(null);
    setReply("");
    const res = await fetch(`/api/tickets/${id}`, { cache: "no-store" });
    setDetailLoading(false);
    if (!res.ok) {
      setDetail(null);
      setBanner({ ok: false, text: "Could not open this ticket." });
      return;
    }
    setDetail((await res.json()).ticket);
    setItems((prev) => prev && prev.map((i) => (i.id === id ? { ...i, unread: false } : i)));
  }, []);

  const send = async () => {
    if (!detail || !reply.trim() || sending) return;
    setSending(true);
    const res = await fetch(`/api/tickets/${detail.id}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: reply }) });
    setSending(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBanner({ ok: false, text: d.error || "The reply was not sent." });
      return;
    }
    setReply("");
    setBanner(d.emailed ? { ok: true, text: "Reply sent. The customer has been emailed." } : { ok: false, text: "Your reply is saved, but the email could not be sent.", retry: true });
    await open(detail.id);
    loadList();
  };

  const resend = async () => {
    if (!detail) return;
    const res = await fetch(`/api/tickets/${detail.id}/resend`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBanner(res.ok && d.emailed ? { ok: true, text: "Email sent." } : { ok: false, text: "The email still could not be sent.", retry: true });
    if (res.ok) open(detail.id);
  };

  const setStatus = async (status: string) => {
    if (!detail) return;
    const res = await fetch(`/api/tickets/${detail.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) return setBanner({ ok: false, text: "Could not change the status." });
    setDetail({ ...detail, status: status as TicketStatus });
    loadList();
  };

  const remove = async () => {
    if (!detail || !window.confirm(`Delete ticket #${detail.number} and its messages for good?`)) return;
    const res = await fetch(`/api/tickets/${detail.id}`, { method: "DELETE" });
    if (!res.ok) return setBanner({ ok: false, text: "Could not delete the ticket." });
    setDetail(null);
    setOpenId(null);
    loadList();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-ticket]") ?? []);
    const i = btns.findIndex((b) => b === document.activeElement);
    const next = e.key === "ArrowDown" ? btns[i + 1] : btns[i - 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const showDetailOnPhone = openId !== null;
  const noProjectsOn = projects.length > 0 && !projects.some((p) => p.supportOn);
  const firstRun = items !== null && items.length === 0 && filter === "needs" && !project;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Support</h1>
        <div className="ml-auto w-48">
          <Label htmlFor="proj" className="sr-only">Project</Label>
          <Select id="proj" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
      </div>

      <div role="group" aria-label="Filter tickets" className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => { setFilter(f.id); setOpenId(null); setDetail(null); }}
            className={`min-h-[44px] rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 ${filter === f.id ? "border-emerald-700 bg-emerald-700 text-white" : "border-gray-400 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-100"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-400">{error} <button className="underline" onClick={loadList}>Try again</button></p>}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* List */}
        <div className={showDetailOnPhone ? "hidden lg:block" : ""}>
          {items === null ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading tickets">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />)}
            </div>
          ) : items.length === 0 ? (
            firstRun ? <Checklist projects={projects} /> : (
              <p className="rounded-lg border border-gray-300 p-4 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">{filter === "needs" || filter === "all" ? "Nothing here." : "Nothing here."}</p>
            )
          ) : (
            <ul ref={listRef} onKeyDown={onListKey} className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-300 bg-white dark:divide-gray-700 dark:border-gray-600 dark:bg-gray-800">
              {items.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    data-ticket
                    onClick={() => open(t.id)}
                    aria-current={openId === t.id ? "true" : undefined}
                    className={`block w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700 ${openId === t.id ? "bg-emerald-50 dark:bg-emerald-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-700/50"}`}
                  >
                    <span className="flex items-center gap-2">
                      {t.unread && <Circle aria-label="Unread" className="h-2.5 w-2.5 shrink-0 fill-emerald-700 text-emerald-700" />}
                      <span className={`min-w-0 flex-1 truncate text-sm ${t.unread ? "font-bold" : "font-medium"} text-gray-900 dark:text-white`}>{t.customerName || t.customerEmail}</span>
                      <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">{formatDistanceToNow(new Date(t.lastActivityAt), { addSuffix: true })}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-gray-700 dark:text-gray-300">{t.subject}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs">
                      <span className="rounded-full border border-gray-400 px-2 py-0.5 font-medium text-gray-800 dark:border-gray-500 dark:text-gray-200">{OWNER_STATUS_LABEL[t.status]}</span>
                      {t.aiAnswered && <AiTag />}
                      <span className="truncate text-gray-600 dark:text-gray-400">#{t.number} · {t.projectName}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Ticket */}
        <div className={showDetailOnPhone ? "" : "hidden lg:block"}>
          {!openId ? (
            <p className="hidden rounded-lg border border-dashed border-gray-400 p-8 text-center text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400 lg:block">Pick a ticket to read it.</p>
          ) : detailLoading || !detail ? (
            <div aria-busy="true" className="space-y-3">
              <Button variant="ghost" className="lg:hidden" onClick={() => { setOpenId(null); setDetail(null); }}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
              {detailLoading ? [0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />) : banner && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{banner.text}</p>}
            </div>
          ) : (
            <section aria-label={`Ticket ${detail.number}`} className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
              <Button variant="ghost" className="mb-2 lg:hidden" onClick={() => { setOpenId(null); setDetail(null); }}><ArrowLeft className="mr-1 h-4 w-4" /> Back to list</Button>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-600 dark:text-gray-400">#{detail.number} · {detail.projectName}</p>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white [overflow-wrap:anywhere]">{detail.subject}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="status" className="sr-only">Status</Label>
                  <Select id="status" value={detail.status} onChange={(e) => setStatus(e.target.value)} className="w-52">
                    {STATUSES.map((s) => <option key={s} value={s}>{OWNER_STATUS_LABEL[s]}</option>)}
                  </Select>
                  {detail.status !== "closed" && <Button variant="outline" onClick={() => setStatus("closed")}><Check className="mr-1 h-4 w-4" /> Close ticket</Button>}
                  <Button variant="ghost" onClick={remove} aria-label="Delete ticket" className="text-red-700"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/50">
                <dt className="text-gray-600 dark:text-gray-400">Email</dt><dd className="text-gray-900 [overflow-wrap:anywhere] dark:text-white">{detail.customerEmail}</dd>
                {detail.fields.map((f) => (
                  <div key={f.id} className="contents">
                    <dt className="text-gray-600 dark:text-gray-400">{f.label}</dt>
                    <dd className="whitespace-pre-wrap text-gray-900 [overflow-wrap:anywhere] dark:text-white">{f.value}</dd>
                  </div>
                ))}
              </dl>

              <ol className="mt-4 space-y-3" aria-label="Conversation">
                {detail.messages.map((m) => (
                  <li key={m.id} className={`rounded-lg border p-3 ${m.author === "owner" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20" : "border-gray-300 dark:border-gray-600"}`}>
                    <p className="mb-1 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                      {m.author === "ai" ? <AiTag /> : <b className="text-gray-900 dark:text-white">{m.author === "owner" ? "You" : detail.customerName || "Customer"}</b>}
                      <span>{formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}</span>
                      {m.author === "owner" && !m.emailedAt && <span className="font-semibold text-red-700 dark:text-red-400">not emailed</span>}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-gray-900 [overflow-wrap:anywhere] dark:text-gray-100">{m.body}</p>
                  </li>
                ))}
              </ol>

              {banner && (
                <p role="status" className={`mt-3 rounded-lg border p-3 text-sm ${banner.ok ? "border-emerald-300 text-emerald-900 dark:text-emerald-200" : "border-red-400 text-red-800 dark:text-red-300"}`}>
                  {banner.text} {banner.retry && <button className="font-semibold underline" onClick={resend}>Try sending the email again</button>}
                </p>
              )}

              <div className="mt-4">
                <Label htmlFor="reply">Your reply</Label>
                <Textarea id="reply" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} aria-describedby="reply-note" />
                <p id="reply-note" className="mt-1 text-xs text-gray-600 dark:text-gray-400">The customer gets this by email with a private link.</p>
                <Button className="mt-2 bg-emerald-700 hover:bg-emerald-800" onClick={send} disabled={sending || !reply.trim()}>
                  {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send reply
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
      {noProjectsOn && items && items.length > 0 && <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Support is currently off for every project.</p>}
    </div>
  );
}

function Checklist({ projects }: { projects: Proj[] }) {
  const target = projects.find((p) => p.supportOn) || projects[0];
  const steps = [
    { label: "Turn on support for a project", done: projects.some((p) => p.supportOn), hash: "" },
    { label: "Choose what the form asks", done: !!target?.setup.formChosen, hash: "#form" },
    { label: "Review the help notes the AI may use", done: !!target?.setup.notesReviewed, hash: "#notes" },
    { label: "Put the code on your site", done: !!target?.setup.siteAdded, hash: "#site" },
  ];
  const allDone = steps.every((s) => s.done);
  if (allDone || !target) {
    return <p className="rounded-lg border border-gray-300 p-4 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">No tickets yet.</p>;
  }
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 dark:border-gray-600 dark:bg-gray-800">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white"><LifeBuoy className="h-5 w-5" /> Set up support</h2>
      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">Four steps and customers can reach you from your own site.</p>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-emerald-700 text-white" : "border border-gray-500 text-gray-700 dark:text-gray-300"}`}>{s.done ? <Check className="h-4 w-4" /> : i + 1}</span>
            <span className={s.done ? "text-gray-600 line-through dark:text-gray-400" : "text-gray-900 dark:text-white"}>{s.label}{s.done && <span className="sr-only"> (done)</span>}</span>
          </li>
        ))}
      </ol>
      <Link href={`/projects/${target.id}/support${steps[next].hash}`} className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2">
        {next === 0 ? `Turn on support for ${target.name}` : "Continue setup"}
      </Link>
    </div>
  );
}
