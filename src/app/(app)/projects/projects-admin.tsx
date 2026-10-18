"use client";

import { useEffect, useState, useCallback } from "react";
import { FolderKanban, Plus, X, Loader2, Pencil, Trash2, Clock, Github } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import type { Project } from "../ideas/ideas-shared";
import Link from "next/link";
import { ProjectRepo } from "./project-repo";

const BLANK = { name: "", slug: "", color: "", context: "", contextSourceUrl: "" };

export function ProjectsAdmin() {
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
    } catch (err) {
      console.error("Failed to fetch projects:", err);
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
          context: form.context,
          contextSourceUrl: form.contextSourceUrl || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Failed to save project");
        return;
      }
      setShowForm(false);
      setForm(BLANK);
      setEditingId(null);
      await fetchProjects();
    } catch (err) {
      console.error("Failed to save project:", err);
      setError("Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  };

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
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  return (
    <div className="space-y-6">
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
                    placeholder="Snapmeal"
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
                    placeholder="snapmeal"
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
              <div>
                <Label htmlFor="context">Project context</Label>
                <Textarea
                  id="context"
                  value={form.context}
                  onChange={(e) => setForm({ ...form, context: e.target.value })}
                  placeholder="Paste this project's ARCHITECTURE.md (or stack, data models, routes, deploy flow, conventions). This is exactly what the AI reads to estimate an idea's effort and write a build prompt."
                  className="mt-1.5 min-h-[220px] font-mono text-xs"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Editing this marks every existing estimate for this project as stale, so you can re-run them.
                </p>
              </div>
              <div>
                <Label htmlFor="contextSourceUrl">Context source URL (optional, for later auto-refresh)</Label>
                <Input
                  id="contextSourceUrl"
                  value={form.contextSourceUrl}
                  onChange={(e) => setForm({ ...form, contextSourceUrl: e.target.value })}
                  placeholder="https://raw.githubusercontent.com/you/repo/main/ARCHITECTURE.md"
                  className="mt-1.5"
                />
              </div>
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
              <div className="flex items-center gap-3">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: p.color || "#94a3b8" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">{p.name}</h3>
                    <span className="text-xs text-gray-400">/{p.slug}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {p._count?.ideas ?? 0} idea{(p._count?.ideas ?? 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    context updated {formatDistanceToNow(new Date(p.contextUpdatedAt), { addSuffix: true })}
                    {!p.context && " · no context yet"}
                  </p>
                </div>
                {progress[p.id] && (
                  <Link
                    href={`/projects/${p.id}/setup`}
                    className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${progress[p.id].done >= progress[p.id].total - 1 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}
                  >
                    {progress[p.id].done >= progress[p.id].total ? "AI ready" : `Setup ${progress[p.id].done}/${progress[p.id].total}`}
                  </Link>
                )}
                <Button variant="ghost" size="sm" onClick={() => setRepoOpen(repoOpen === p.id ? null : p.id)} aria-label="GitHub repo and AI setup">
                  <Github className="w-4 h-4 mr-1" /> Repo &amp; AI setup
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(p)} aria-label="Edit">
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(p)}
                  aria-label="Delete"
                  className="text-red-500 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              {repoOpen === p.id && <ProjectRepo projectId={p.id} onChanged={() => refreshProgress(p.id)} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
