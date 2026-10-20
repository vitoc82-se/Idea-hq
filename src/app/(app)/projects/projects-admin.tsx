"use client";

import { Notice } from "@/components/notice";
import { useEffect, useState, useCallback } from "react";
import { FolderKanban, Plus, X, Loader2, Pencil, Trash2, Github, BookOpen, LifeBuoy, Upload, Megaphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDistanceToNow } from "date-fns";
import type { Project } from "../ideas/ideas-shared";
import Link from "next/link";
import { ProjectRepo } from "./project-repo";
import { completeness, knowledgeFor, knowledgeTone, KNOWLEDGE_TONE_CLASSES } from "@/lib/knowledge";

// How much of the project the AI knows, from the stored knowledge.
const knowPct = (p: { knowledge?: unknown; context?: string | null }) => completeness(knowledgeFor(p.knowledge ?? null, p.context)).percent;

const BLANK = { name: "", slug: "", color: "", context: "", contextSourceUrl: "" };

export function ProjectsAdmin({ supportEnabled = false }: { supportEnabled?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoOpen, setRepoOpen] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.ok) setProjects(await res.json());
      else setError("Could not load your projects. Reload the page to try again.");
    } catch {
      setError("Could not reach Idea HQ to load your projects. Check your connection and reload the page.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Cheap (no GitHub calls) setup progress for the chips.
  const refreshProgress = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/projects/${id}/setup-status?quick=1`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setProgress((cur) => ({ ...cur, [id]: { done: j.done, total: j.total } }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    projects.forEach((p) => refreshProgress(p.id));
  }, [projects, refreshProgress]);

  const openNew = () => {
    setEditingId(null);
    setForm(BLANK);
    setError(null);
    setShowForm(true);
  };

  const openEdit = (p: Project) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      slug: p.slug,
      color: p.color || "",
      context: p.context || "",
      contextSourceUrl: p.contextSourceUrl || "",
    });
    setError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const url = editingId ? `/api/projects/${editingId}` : "/api/projects";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug || undefined,
          color: form.color || null,
          contextSourceUrl: form.contextSourceUrl || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not save the project. Check the name and try again.");
        return;
      }
      setShowForm(false);
      setForm(BLANK);
      setEditingId(null);
      await fetchProjects();
    } catch {
      setError("Could not reach Idea HQ to save the project. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  // Save a project's monthly cap ("" clears it). Returns an error sentence, or null when saved.
  const saveCap = async (p: Project, text: string): Promise<string | null> => {
    const t = text.trim().replace(",", ".").replace(/^\$/, "");
    const value = t === "" ? null : Number(t);
    if (value !== null && !Number.isFinite(value)) return "Type a dollar amount like 10, or leave it empty for no cap.";
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monthlyCapUsd: value }) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return d?.error || "Could not save the cap. Try again in a moment.";
      }
      await fetchProjects();
      return null;
    } catch {
      return "Could not reach Idea HQ to save the cap. Check your connection and try again.";
    }
  };

  const monthTotal = projects.reduce((n, p) => n + (p.spend?.monthUsd ?? 0), 0);

  const handleDelete = async (p: Project) => {
    const n = p._count?.ideas ?? 0;
    if (
      !confirm(
        `Delete "${p.name}"${n ? ` and its ${n} idea${n === 1 ? "" : "s"}` : ""}? This can't be undone.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      if (res.ok) await fetchProjects();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not delete the project. It is still here; try again in a moment.");
      }
    } catch {
      setError("Could not reach Idea HQ to delete the project. Check your connection and try again.");
    }
  };

  return (
    <div className="space-y-6">
      {!showForm && <Notice text={error ?? ""} onClose={() => setError(null)} />}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Each project&apos;s context is what the AI estimates ideas against — keep it current.
          </p>
        </div>
        <Button onClick={showForm ? () => setShowForm(false) : openNew}>
          {showForm ? (
            <>
              <X className="w-4 h-4 mr-2" /> Cancel
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" /> New Project
            </>
          )}
        </Button>
      </div>

      {projects.length > 0 && (
        <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="month-total">
          AI spend this month across your projects: <b>${monthTotal.toFixed(2)}</b>. It is billed to your own AI key, not by Idea HQ.
        </p>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit project" : "Add a project"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="My app"
                    required
                    autoFocus
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="slug">Slug (optional)</Label>
                  <Input
                    id="slug"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="my-app"
                    className="mt-1.5"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="color">Chip color (optional)</Label>
                <Input
                  id="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  placeholder="#10b981"
                  className="mt-1.5 w-full sm:w-48"
                />
              </div>
              {editingId && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  What the AI knows about this project lives on its{" "}
                  <Link href={`/projects/${editingId}/knowledge`} className="text-emerald-600 hover:underline">knowledge page</Link>.
                </p>
              )}
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? "Saving..." : editingId ? "Save changes" : "Create project"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderKanban className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">No projects yet</h3>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Add your first project, then start capturing ideas for it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color || "#94a3b8" }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white [overflow-wrap:anywhere]">{p.name}</h3>
                    {progress[p.id] && (
                      <Link
                        href={`/projects/${p.id}/setup`}
                        className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${progress[p.id].done >= progress[p.id].total - 1 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"}`}
                      >
                        {progress[p.id].done >= progress[p.id].total ? "AI ready" : `Setup ${progress[p.id].done}/${progress[p.id].total}`}
                      </Link>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                    /{p.slug} · {p._count?.ideas ?? 0} idea{(p._count?.ideas ?? 0) === 1 ? "" : "s"} · context updated {formatDistanceToNow(new Date(p.contextUpdatedAt), { addSuffix: true })}
                    {!p.context && " · no context yet"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(p)} aria-label={`Delete ${p.name}`} className="text-red-600 hover:text-red-700">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 pl-6">
                <Link
                  href={`/projects/${p.id}/knowledge`}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap shadow-sm ${KNOWLEDGE_TONE_CLASSES[knowledgeTone(knowPct(p))].button}`}
                  title="What the AI knows about this project. Click to improve it."
                >
                  <BookOpen className="w-4 h-4" />
                  Project knowledge {knowPct(p)}%
                </Link>
                {[
                  ...(supportEnabled ? [{ href: `/projects/${p.id}/support`, label: "Support", icon: LifeBuoy }] : []),
                  { href: `/projects/${p.id}/changes`, label: "What\u2019s new page", icon: Megaphone },
                  { href: `/projects/${p.id}/import`, label: "Import ideas", icon: Upload },
                ].map((l) => (
                  <Link key={l.href} href={l.href} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800">
                    <l.icon className="w-4 h-4" aria-hidden="true" />
                    {l.label}
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={() => setRepoOpen(repoOpen === p.id ? null : p.id)}
                  aria-expanded={repoOpen === p.id}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
                >
                  <Github className="w-4 h-4" aria-hidden="true" /> Repo &amp; AI setup
                </button>
              </div>
              <SpendRow project={p} onSave={(text) => saveCap(p, text)} />
              {repoOpen === p.id && <ProjectRepo projectId={p.id} onChanged={() => refreshProgress(p.id)} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// One project's AI spend this month and its optional monthly cap.
function SpendRow({ project, onSave }: { project: Project; onSave: (text: string) => Promise<string | null> }) {
  const spend = project.spend ?? { monthUsd: 0, runs: 0, unpriced: 0 };
  const cap = project.monthlyCapUsd ?? null;
  const [text, setText] = useState(cap == null ? "" : String(cap));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setText(cap == null ? "" : String(cap));
  }, [cap]);
  const reached = cap != null && spend.monthUsd >= cap;

  const commit = async () => {
    const current = cap == null ? "" : String(cap);
    if (text.trim() === current) return;
    setSaving(true);
    setErr("");
    const e = await onSave(text);
    setSaving(false);
    if (e) {
      setErr(e);
      setText(current);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 pl-6 text-sm text-gray-700 dark:text-gray-300">
      <p>
        This month: <b>${spend.monthUsd.toFixed(2)}</b> across {spend.runs} run{spend.runs === 1 ? "" : "s"}
        {spend.unpriced > 0 && <span className="text-gray-600 dark:text-gray-400"> · cost not reported for {spend.unpriced}</span>}
      </p>
      <div className="flex items-center gap-2">
        <label htmlFor={`cap-${project.id}`}>Monthly cap $</label>
        <Input
          id={`cap-${project.id}`}
          className="h-9 w-24"
          inputMode="decimal"
          value={text}
          placeholder="none"
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-describedby={`cap-note-${project.id}`}
        />
      </div>
      <p id={`cap-note-${project.id}`} className={reached ? "text-xs font-semibold text-red-700 dark:text-red-400" : "sr-only"}>
        {reached ? "Cap reached: new runs are paused until next month or a higher cap." : cap != null ? `$${(cap - spend.monthUsd).toFixed(2)} left this month.` : "No cap."}
      </p>
      {!reached && cap != null && <p className="text-xs text-gray-600 dark:text-gray-400" aria-hidden="true">${(cap - spend.monthUsd).toFixed(2)} left</p>}
      {err && <p role="alert" className="w-full text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
