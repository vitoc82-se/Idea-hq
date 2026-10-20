"use client";

import { Notice } from "@/components/notice";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Lightbulb,
  Plus,
  X,
  Search,
  Star,
  ChevronRight,
  LayoutGrid,
  Loader2,
  List,
  Columns3,
  Link2,
  FolderKanban,
  Layers,
  StickyNote,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { KanbanBoard } from "./ideas-kanban";
import {
  Idea,
  Project,
  STATUSES,
  PRIORITIES,
  STATUS_STYLES,
  PRIORITY_STYLES,
  IMPACT_STYLES,
  COMPLEXITY_STYLES,
  PRIORITY_WEIGHT,
  EFFORT_WEIGHT,
  isQuickWin,
  isEpic,
  valueEffortScore,
  blockingIdeas,
  tagStyle,
} from "./ideas-shared";

type SortKey = "newest" | "priority" | "effort" | "quickwins";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "priority", label: "Priority" },
  { value: "effort", label: "Least effort" },
  { value: "quickwins", label: "Quick wins first" },
];

export function IdeasBoard() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ title: "", notes: "", priority: "none", projectId: "" });

  // Filter / sort / search state
  const [search, setSearch] = useState("");
  const [fProject, setFProject] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fPriority, setFPriority] = useState("all");
  const [fComplexity, setFComplexity] = useState("all");
  const [fTag, setFTag] = useState("all");
  const [quickOnly, setQuickOnly] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const [showMatrix, setShowMatrix] = useState(false);
  const [view, setView] = useState<"list" | "board">("list");

  const fetchIdeas = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas", { cache: "no-store" });
      if (res.ok) setIdeas(await res.json());
      else setNotice("Could not load your ideas. Reload the page to try again.");
    } catch {
      setNotice("Could not reach Idea HQ to load your ideas. Check your connection and reload the page.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Ideas the AI has not estimated yet (imported ones, or an estimate that failed).
  // Estimating is explicit: it costs AI calls, so it never starts by itself.
  const [estimatingIds, setEstimatingIds] = useState<Set<string>>(new Set());
  const [estimateMsg, setEstimateMsg] = useState("");
  const estimateIdeas = useCallback(async (ids: string[]) => {
    setEstimateMsg("");
    setEstimatingIds((prev) => new Set([...Array.from(prev), ...ids]));
    const queue = [...ids];
    let stop = "";
    const settle = (id: string) => setEstimatingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined && !stop; id = queue.shift()) {
        try {
          const res = await fetch(`/api/ideas/${id}/estimate`, { method: "POST" });
          if (res.ok) {
            const updated: Idea = await res.json();
            setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, ...updated, project: i.project, _count: i._count } : i)));
          } else if (res.status === 429) {
            stop = "Daily AI limit reached. The rest can be estimated tomorrow.";
          } else {
            const d = await res.json().catch(() => ({}));
            stop = d.error || "An estimate failed. Try again in a moment.";
          }
        } catch {
          stop = "An estimate failed. Try again in a moment.";
        }
        settle(id);
      }
    };
    await Promise.all([worker(), worker()]);
    queue.forEach(settle);
    if (stop) setEstimateMsg(stop);
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.ok) setProjects(await res.json());
      else setNotice("Could not load your projects, so new ideas cannot be assigned yet. Reload the page to try again.");
    } catch {
      setNotice("Could not reach Idea HQ to load your projects. Check your connection and reload the page.");
    }
  }, []);

  useEffect(() => {
    fetchIdeas();
    fetchProjects();
  }, [fetchIdeas, fetchProjects]);

  // Default the capture form's project to the one you're filtered to, else the
  // first project — so the common case needs zero clicks.
  const openForm = () => {
    const def = fProject !== "all" ? fProject : projects[0]?.id || "";
    setForm({ title: "", notes: "", priority: "none", projectId: def });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.projectId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          notes: form.notes || undefined,
          priority: form.priority,
          projectId: form.projectId,
        }),
      });
      if (res.ok) {
        const created: Idea = await res.json();
        setForm({ title: "", notes: "", priority: "none", projectId: "" });
        setShowForm(false);
        setIdeas((prev) => [created, ...prev]);
        // Kick off the AI estimate in the background; it fills in on next load
        // or when you open the idea.
        fetch(`/api/ideas/${created.id}/estimate`, { method: "POST" }).catch(
          () => {}
        );
      } else {
        const d = await res.json().catch(() => null);
        setNotice(d?.error || "Could not save the idea. Your text is still in the form, so try again in a moment.");
      }
    } catch {
      setNotice("Could not reach Idea HQ to save the idea. Your text is still in the form; check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const patchStatus = async (id: string, status: string) => {
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      const res = await fetch(`/api/ideas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("not saved");
    } catch {
      setNotice("Could not move that idea, so it was put back where it was.");
      fetchIdeas();
    }
  };

  // Save a closure note (from the inline input shown when a card moves to done).
  const patchClosure = async (id: string, note: string) => {
    const closureNote = note.trim() || null;
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, closureNote } : i)));
    try {
      const res = await fetch(`/api/ideas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closureNote }),
      });
      if (!res.ok) throw new Error("not saved");
    } catch {
      setNotice("Could not save the closing note. Open the idea and add it again.");
      fetchIdeas();
    }
  };

  // id -> idea, and the set of ideas currently blocked by an unshipped dependency.
  const byId = useMemo(
    () => new Map(ideas.map((i) => [i.id, i])),
    [ideas]
  );
  const blockedIds = useMemo(() => {
    const s = new Set<string>();
    for (const i of ideas) if (blockingIdeas(i, byId).length) s.add(i.id);
    return s;
  }, [ideas, byId]);

  // All tags in use (for the tag filter).
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const i of ideas) for (const t of i.tags) set.add(t);
    return Array.from(set).sort();
  }, [ideas]);

  // ---- derived: stats ----
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let quick = 0;
    for (const i of ideas) {
      byStatus[i.status] = (byStatus[i.status] || 0) + 1;
      if (isQuickWin(i)) quick++;
    }
    const open = ideas.filter(
      (i) => i.status !== "done" && i.status !== "parked"
    ).length;
    return { total: ideas.length, quick, open, byStatus };
  }, [ideas]);

  const sortIdeas = useCallback(
    (list: Idea[]) =>
      [...list].sort((a, b) => {
        switch (sort) {
          case "priority":
            return (
              (PRIORITY_WEIGHT[b.priority] ?? 0) -
                (PRIORITY_WEIGHT[a.priority] ?? 0) ||
              +new Date(b.createdAt) - +new Date(a.createdAt)
            );
          case "effort": {
            const ea = a.complexity ? EFFORT_WEIGHT[a.complexity] : 99;
            const eb = b.complexity ? EFFORT_WEIGHT[b.complexity] : 99;
            return ea - eb || +new Date(b.createdAt) - +new Date(a.createdAt);
          }
          case "quickwins":
            return (
              valueEffortScore(b) - valueEffortScore(a) ||
              +new Date(b.createdAt) - +new Date(a.createdAt)
            );
          default:
            return +new Date(b.createdAt) - +new Date(a.createdAt);
        }
      }),
    [sort]
  );

  // Filters shared by both views (everything except status, which the kanban
  // columns already represent).
  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ideas.filter((i) => {
      if (fProject !== "all" && i.projectId !== fProject) return false;
      if (fPriority !== "all" && i.priority !== fPriority) return false;
      if (fComplexity !== "all" && i.complexity !== fComplexity) return false;
      if (fTag !== "all" && !i.tags.includes(fTag)) return false;
      if (quickOnly && !isQuickWin(i)) return false;
      if (openOnly && (i.status === "done" || i.status === "parked")) return false;
      if (q) {
        const hay = `${i.title} ${i.notes || ""} ${i.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [ideas, search, fProject, fPriority, fComplexity, fTag, quickOnly, openOnly]);

  // List view also honors the status filter and the sort order.
  const visible = useMemo(() => {
    const list =
      fStatus === "all"
        ? baseFiltered
        : baseFiltered.filter((i) => i.status === fStatus);
    return sortIdeas(list);
  }, [baseFiltered, fStatus, sortIdeas]);

  const kanbanIdeas = useMemo(() => sortIdeas(baseFiltered), [baseFiltered, sortIdeas]);

  const filtersActive =
    search.trim() !== "" ||
    fProject !== "all" ||
    fStatus !== "all" ||
    fPriority !== "all" ||
    fComplexity !== "all" ||
    fTag !== "all" ||
    quickOnly ||
    openOnly;

  const resetFilters = () => {
    setSearch("");
    setFProject("all");
    setFStatus("all");
    setFPriority("all");
    setFComplexity("all");
    setFTag("all");
    setQuickOnly(false);
    setOpenOnly(false);
  };

  // Clicking a status stat-chip filters the list to that status (a list concept,
  // so switch to List view); clicking it again clears back to all.
  const toggleStatusFilter = (status: string) => {
    setView("list");
    setFStatus((cur) => (cur === status ? "all" : status));
  };

  return (
    <div className="space-y-6">
      <Notice text={notice} onClose={() => setNotice("")} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ideas</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Your private backlog — capture it, and we&apos;ll estimate the build
            automatically
          </p>
        </div>
        <Button
          onClick={showForm ? () => setShowForm(false) : openForm}
          disabled={!showForm && projects.length === 0}
          title={projects.length === 0 ? "Add a project first" : undefined}
        >
          {showForm ? (
            <>
              <X className="w-4 h-4 mr-2" /> Cancel
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" /> New Idea
            </>
          )}
        </Button>
      </div>

      {projects.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <FolderKanban className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Add a project first
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mt-1 mb-4">
              Ideas belong to a project so the AI can estimate them against the right codebase.
            </p>
            <Link href="/projects">
              <Button>
                <FolderKanban className="w-4 h-4 mr-2" /> Go to Projects
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Capture an idea</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="project">Project</Label>
                <Select
                  id="project"
                  value={form.projectId}
                  onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                  required
                  className="mt-1.5 w-full sm:w-64"
                >
                  <option value="" disabled>
                    Select a project…
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="title">Idea</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g., Weekly email summary of my macros"
                  required
                  autoFocus
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Any detail, context, or why it matters..."
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="priority">Priority</Label>
                <Select
                  id="priority"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="mt-1.5 w-full sm:w-48"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" disabled={submitting || !form.projectId} className="w-full">
                {submitting ? "Saving..." : "Save idea"}
              </Button>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                After you save, the AI estimates complexity, value and
                implementation scope in the background.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      ) : ideas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Lightbulb className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              No ideas yet
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Capture the first idea for one of your projects
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary stat chips — clickable filters. */}
          <div className="flex flex-wrap items-center gap-2">
            <StatChip
              label="Total"
              value={stats.total}
              active={!filtersActive}
              onClick={resetFilters}
              title="Show all ideas (clear filters)"
            />
            <StatChip
              label="Open"
              value={stats.open}
              active={openOnly}
              onClick={() => setOpenOnly((v) => !v)}
              title="Only ideas that aren't done or parked"
            />
            <button
              type="button"
              onClick={() => setQuickOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border transition ${
                quickOnly
                  ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300"
                  : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
              title="A quick win = high value for low effort (S/M)"
            >
              <Star className="w-3.5 h-3.5" />
              {stats.quick} quick win{stats.quick === 1 ? "" : "s"}
            </button>
            {STATUSES.filter((s) => stats.byStatus[s.value]).map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleStatusFilter(s.value)}
                title={`Show only ${s.label.toLowerCase()} ideas`}
                className={`text-xs px-2.5 py-1 rounded-full transition ${STATUS_STYLES[s.value]} ${
                  fStatus === s.value
                    ? "ring-2 ring-offset-1 ring-emerald-500 dark:ring-offset-gray-900"
                    : "hover:opacity-80"
                }`}
              >
                {stats.byStatus[s.value]} {s.label.toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowMatrix((v) => !v)}
              className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              {showMatrix ? "Hide" : "Value / effort"}
            </button>
          </div>

          {showMatrix && <ValueEffortMatrix ideas={ideas} />}

          {/* Filter / search / sort bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* View toggle */}
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
              <button
                type="button"
                onClick={() => setView("list")}
                className={`inline-flex items-center gap-1 text-sm px-2.5 py-1 rounded-md ${
                  view === "list"
                    ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                    : "text-gray-500 dark:text-gray-400"
                }`}
                aria-label="List view"
              >
                <List className="w-4 h-4" /> List
              </button>
              <button
                type="button"
                onClick={() => setView("board")}
                className={`inline-flex items-center gap-1 text-sm px-2.5 py-1 rounded-md ${
                  view === "board"
                    ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                    : "text-gray-500 dark:text-gray-400"
                }`}
                aria-label="Board view"
              >
                <Columns3 className="w-4 h-4" /> Board
              </button>
            </div>

            {projects.length > 1 && (
              <Select
                value={fProject}
                onChange={(e) => setFProject(e.target.value)}
                className="w-auto text-sm"
                aria-label="Filter by project"
              >
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}

            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ideas…"
                className="pl-9"
              />
            </div>
            {view === "list" && (
              <Select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
                className="w-auto text-sm"
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
            <Select
              value={fPriority}
              onChange={(e) => setFPriority(e.target.value)}
              className="w-auto text-sm"
              aria-label="Filter by priority"
            >
              <option value="all">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Select
              value={fComplexity}
              onChange={(e) => setFComplexity(e.target.value)}
              className="w-auto text-sm"
              aria-label="Filter by effort"
            >
              <option value="all">Any effort</option>
              <option value="S">S</option>
              <option value="M">M</option>
              <option value="L">L</option>
              <option value="XL">XL</option>
            </Select>
            {allTags.length > 0 && (
              <Select
                value={fTag}
                onChange={(e) => setFTag(e.target.value)}
                className="w-auto text-sm"
                aria-label="Filter by tag"
              >
                <option value="all">Any tag</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </Select>
            )}
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="w-auto text-sm"
              aria-label="Sort"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  Sort: {s.label}
                </option>
              ))}
            </Select>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Clear
              </Button>
            )}
          </div>

          {(() => {
            const todo = ideas.filter((i) => !i.aiEstimatedAt && !i.scope && i.status !== "done" && !i.parentId);
            const running = todo.some((i) => estimatingIds.has(i.id));
            if (todo.length === 0 && !estimateMsg) return null;
            return (
              <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-300 p-3 text-sm text-gray-800 dark:border-gray-600 dark:text-gray-200">
                {todo.length > 0 && <span>{todo.length} idea{todo.length === 1 ? " has" : "s have"} no estimate yet.</span>}
                {todo.length > 0 && (
                  <Button size="sm" variant="outline" disabled={running} onClick={() => estimateIdeas(todo.filter((i) => !estimatingIds.has(i.id)).map((i) => i.id))}>
                    {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{running ? "Estimating…" : "Estimate them all"}
                  </Button>
                )}
                {estimateMsg && <span className="text-red-700 dark:text-red-400">{estimateMsg}</span>}
              </div>
            );
          })()}

          {/* Board or list */}
          {view === "board" ? (
            kanbanIdeas.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-gray-500 dark:text-gray-400">
                  No ideas match these filters.
                </CardContent>
              </Card>
            ) : (
              <KanbanBoard
                ideas={kanbanIdeas}
                blockedIds={blockedIds}
                onStatus={patchStatus}
                onClosure={patchClosure}
              />
            )
          ) : visible.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-gray-500 dark:text-gray-400">
                No ideas match these filters.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {visible.map((idea) => (
                <IdeaRow
                  key={idea.id}
                  idea={idea}
                  blocked={blockedIds.has(idea.id)}
                  onStatus={patchStatus}
                  onClosure={patchClosure}
                  estimating={estimatingIds.has(idea.id)}
                  onEstimate={() => estimateIdeas([idea.id])}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  active,
  onClick,
  title,
}: {
  label: string;
  value: number;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border transition ${
        active
          ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
          : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
    >
      <span className="font-semibold text-gray-900 dark:text-white">{value}</span>
      {label}
    </button>
  );
}

function IdeaRow({
  idea,
  blocked,
  onStatus,
  onClosure,
  estimating,
  onEstimate,
}: {
  idea: Idea;
  blocked: boolean;
  onStatus: (id: string, status: string) => void;
  onClosure: (id: string, note: string) => void;
  estimating: boolean;
  onEstimate: () => void;
}) {
  const quick = isQuickWin(idea);
  const needsEstimate = !idea.aiEstimatedAt && !idea.scope && idea.status !== "done" && !idea.parentId;
  const [showClosure, setShowClosure] = useState(false);
  const [closureText, setClosureText] = useState(idea.closureNote || "");
  return (
    <Card className="hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
        <Link href={`/ideas/${idea.id}`} className="min-w-0 flex-1 group">
          <div className="flex items-center gap-2 flex-wrap">
            {idea.project && (
              <span
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                title="Project"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: idea.project.color || "#94a3b8" }}
                />
                {idea.project.name}
              </span>
            )}
            {isEpic(idea) && (
              <span
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                title="Broken into stories"
              >
                <Layers className="w-3 h-3" /> {idea._count?.children} stories
              </span>
            )}
            {quick && (
              <span
                className="inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                title="Quick win — high value, low effort"
              >
                <Star className="w-3 h-3" /> Quick win
              </span>
            )}
            {blocked && (
              <span
                className="inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300"
                title="Blocked by another idea that hasn't shipped"
              >
                <Link2 className="w-3 h-3" /> Blocked
              </span>
            )}
            <h3 className="font-semibold text-gray-900 dark:text-white truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
              {idea.title}
            </h3>
            {idea.priority !== "none" && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_STYLES[idea.priority]}`}
              >
                {idea.priority}
              </span>
            )}
            {idea.impact && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${IMPACT_STYLES[idea.impact]}`}
                title="AI value estimate"
              >
                {idea.impact} value
              </span>
            )}
            {idea.complexity && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  COMPLEXITY_STYLES[idea.complexity] || COMPLEXITY_STYLES.M
                }`}
                title="AI effort estimate"
              >
                {idea.complexity}
              </span>
            )}
            {idea.tags.map((t) => (
              <span
                key={t}
                className={`text-xs px-2 py-0.5 rounded-full ${tagStyle(t)}`}
              >
                {t}
              </span>
            ))}
            {needsEstimate && estimating && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <Loader2 className="w-3 h-3 animate-spin" /> estimating
              </span>
            )}
            {needsEstimate && !estimating && (
              <button type="button" onClick={onEstimate} className="text-xs text-emerald-700 underline dark:text-emerald-400">
                not estimated, estimate now
              </button>
            )}
            {idea.status === "done" && idea.closureNote && (
              <span
                title={idea.closureNote}
                className="inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              >
                <StickyNote className="w-3 h-3" /> note
              </span>
            )}
          </div>
          {idea.notes && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {idea.notes}
            </p>
          )}
        </Link>

        <Select
          value={idea.status}
          onChange={(e) => {
            const v = e.target.value;
            onStatus(idea.id, v);
            if (v === "done" && idea.status !== "done") {
              setClosureText(idea.closureNote || "");
              setShowClosure(true);
            }
          }}
          className="w-32 text-sm shrink-0"
          aria-label="Status"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Link
          href={`/ideas/${idea.id}`}
          className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 shrink-0"
          aria-label="Open idea"
        >
          <ChevronRight className="w-5 h-5" />
        </Link>
        </div>

        {showClosure && (
          <div className="mt-2 flex items-start gap-2">
            <Textarea
              autoFocus
              value={closureText}
              onChange={(e) => setClosureText(e.target.value)}
              placeholder="What shipped? (optional — Save or Skip)"
              className="text-sm min-h-[46px]"
            />
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                size="sm"
                onClick={() => {
                  onClosure(idea.id, closureText);
                  setShowClosure(false);
                }}
              >
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowClosure(false)}>
                Skip
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// 2x2 value-vs-effort matrix. Only estimated ideas (impact + effort) are placed.
function ValueEffortMatrix({ ideas }: { ideas: Idea[] }) {
  // Epics are containers, not work — their stories are placed instead.
  const estimated = ideas.filter((i) => i.impact && i.complexity && !isEpic(i));
  const highValue = (i: Idea) => i.impact === "high";
  const lowEffort = (i: Idea) => i.complexity === "S" || i.complexity === "M";

  const cells: {
    key: string;
    title: string;
    hint: string;
    tone: string;
    items: Idea[];
  }[] = [
    {
      key: "quick",
      title: "Quick wins",
      hint: "High value · low effort",
      tone: "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/10",
      items: estimated.filter((i) => highValue(i) && lowEffort(i)),
    },
    {
      key: "bets",
      title: "Big bets",
      hint: "High value · high effort",
      tone: "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/10",
      items: estimated.filter((i) => highValue(i) && !lowEffort(i)),
    },
    {
      key: "fill",
      title: "Fill-ins",
      hint: "Lower value · low effort",
      tone: "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40",
      items: estimated.filter((i) => !highValue(i) && lowEffort(i)),
    },
    {
      key: "sink",
      title: "Time sinks",
      hint: "Lower value · high effort",
      tone: "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40",
      items: estimated.filter((i) => !highValue(i) && !lowEffort(i)),
    },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cells.map((c) => (
            <div key={c.key} className={`rounded-lg border p-3 ${c.tone}`}>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-1">
                  {c.key === "quick" && <Star className="w-3.5 h-3.5 text-amber-500" />}
                  {c.title}
                </span>
                <span className="text-xs text-gray-400">{c.hint}</span>
              </div>
              <div className="mt-2 space-y-1">
                {c.items.length === 0 ? (
                  <p className="text-xs text-gray-400">—</p>
                ) : (
                  c.items.map((i) => (
                    <Link
                      key={i.id}
                      href={`/ideas/${i.id}`}
                      className="block text-sm text-gray-700 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 truncate"
                    >
                      {i.title}{" "}
                      <span className="text-xs text-gray-400">({i.complexity})</span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
        {estimated.length < ideas.length && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            {ideas.length - estimated.length} idea
            {ideas.length - estimated.length === 1 ? "" : "s"} not yet estimated —
            open one to run the estimate.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
