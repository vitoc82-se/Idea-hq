"use client";

import { useState, useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Check,
  X,
  Trash2,
  Sparkles,
  Loader2,
  Star,
  Tag as TagIcon,
  Link2,
  Terminal,
  Copy,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Idea,
  IdeaRef,
  STATUSES,
  PRIORITIES,
  IMPACTS,
  COMPLEXITIES,
  STATUS_STYLES,
  PRIORITY_STYLES,
  IMPACT_STYLES,
  COMPLEXITY_STYLES,
  tagStyle,
  parseTagInput,
  normalizeTags,
  isQuickWin,
} from "./ideas-shared";

export function IdeaDetail({
  initial,
  allIdeas,
  blocks,
}: {
  initial: Idea;
  allIdeas: IdeaRef[];
  blocks: IdeaRef[];
}) {
  const router = useRouter();
  const [idea, setIdea] = useState<Idea>(initial);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: initial.title,
    notes: initial.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [copied, setCopied] = useState(false);

  // Collapsible sections so a long idea (big notes, scope, build prompt) doesn't
  // force endless scrolling. All start expanded; the user folds what they want.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isOpen = (k: string) => !collapsed[k];
  const toggleSection = (k: string) =>
    setCollapsed((prev) => ({ ...prev, [k]: !prev[k] }));

  const idTitle = useMemo(() => {
    const m = new Map<string, IdeaRef>();
    for (const r of allIdeas) m.set(r.id, r);
    return m;
  }, [allIdeas]);

  const patch = useCallback(
    async (data: Partial<Idea>) => {
      setIdea((prev) => ({ ...prev, ...data }));
      try {
        await fetch(`/api/ideas/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } catch (err) {
        console.error("Failed to update idea:", err);
      }
    },
    [initial.id]
  );

  const runEstimate = useCallback(async () => {
    setEstimating(true);
    try {
      const res = await fetch(`/api/ideas/${initial.id}/estimate`, {
        method: "POST",
      });
      if (res.ok) setIdea(await res.json());
    } catch (err) {
      console.error("Estimate failed:", err);
    } finally {
      setEstimating(false);
    }
  }, [initial.id]);

  const runPlan = useCallback(async () => {
    setPlanning(true);
    try {
      const res = await fetch(`/api/ideas/${initial.id}/plan`, {
        method: "POST",
      });
      if (res.ok) setIdea(await res.json());
      else console.error("Plan failed:", await res.text());
    } catch (err) {
      console.error("Plan failed:", err);
    } finally {
      setPlanning(false);
    }
  }, [initial.id]);

  const startEdit = () => {
    setEditForm({ title: idea.title, notes: idea.notes || "" });
    setEditing(true);
  };

  const saveEdit = async () => {
    const title = editForm.title.trim();
    if (!title) return;
    const notes = editForm.notes.trim() || null;
    const changed = title !== idea.title || notes !== (idea.notes || null);
    setSaving(true);
    setIdea((prev) => ({ ...prev, title, notes }));
    try {
      await fetch(`/api/ideas/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, notes }),
      });
      setEditing(false);
      if (changed) runEstimate();
    } catch (err) {
      console.error("Failed to save idea:", err);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm("Delete this idea? This can't be undone.")) return;
    setDeleting(true);
    try {
      await fetch(`/api/ideas/${initial.id}`, { method: "DELETE" });
      router.push("/ideas");
      router.refresh();
    } catch (err) {
      console.error("Failed to delete idea:", err);
      setDeleting(false);
    }
  };

  // ---- tags ----
  const commitTagInput = () => {
    const added = parseTagInput(tagInput);
    if (added.length) {
      const next = normalizeTags([...idea.tags, ...added]);
      patch({ tags: next });
    }
    setTagInput("");
  };
  const removeTag = (t: string) =>
    patch({ tags: idea.tags.filter((x) => x !== t) });

  // ---- dependencies ----
  const addDep = (id: string) => {
    if (!id || idea.blockedBy.includes(id)) return;
    patch({ blockedBy: [...idea.blockedBy, id] });
  };
  const removeDep = (id: string) =>
    patch({ blockedBy: idea.blockedBy.filter((x) => x !== id) });

  const copyPlan = async () => {
    if (!idea.plan) return;
    try {
      await navigator.clipboard.writeText(idea.plan);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  };

  const quick = isQuickWin(idea);
  const depOptions = allIdeas.filter((r) => !idea.blockedBy.includes(r.id));

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/ideas"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400"
      >
        <ArrowLeft className="w-4 h-4" /> Back to ideas
      </Link>

      <Card>
        <CardContent className="p-5 space-y-5">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveEdit();
              }}
              className="space-y-3"
            >
              <div>
                <Label htmlFor="edit-title">Idea</Label>
                <Input
                  id="edit-title"
                  value={editForm.title}
                  onChange={(e) =>
                    setEditForm({ ...editForm, title: e.target.value })
                  }
                  required
                  autoFocus
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                  placeholder="Any detail, context, or why it matters..."
                  className="mt-1.5 min-h-[120px]"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  <Check className="w-4 h-4 mr-1" />
                  {saving ? "Saving..." : "Save changes"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(false)}
                >
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Editing the idea re-runs the AI estimate.
              </p>
            </form>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {quick && (
                      <span
                        className="inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                        title="Quick win — high value, low effort"
                      >
                        <Star className="w-3 h-3" /> Quick win
                      </span>
                    )}
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        STATUS_STYLES[idea.status] || STATUS_STYLES.new
                      }`}
                    >
                      {STATUSES.find((s) => s.value === idea.status)?.label ||
                        idea.status}
                    </span>
                    {idea.priority !== "none" && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_STYLES[idea.priority]}`}
                      >
                        {idea.priority} priority
                      </span>
                    )}
                    {idea.impact && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${IMPACT_STYLES[idea.impact]}`}
                      >
                        {idea.impact} value
                      </span>
                    )}
                    {idea.complexity && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          COMPLEXITY_STYLES[idea.complexity] || COMPLEXITY_STYLES.M
                        }`}
                      >
                        {idea.complexity} effort
                      </span>
                    )}
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {idea.title}
                  </h1>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Added {new Date(idea.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startEdit}
                  className="shrink-0"
                >
                  <Pencil className="w-4 h-4 mr-1" /> Edit
                </Button>
              </div>

              {/* Notes */}
              <div>
                <SectionToggle
                  open={isOpen("notes")}
                  onClick={() => toggleSection("notes")}
                >
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Notes
                  </span>
                </SectionToggle>
                {isOpen("notes") &&
                  (idea.notes ? (
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-1">
                      {idea.notes}
                    </p>
                  ) : (
                    <p className="text-gray-400 dark:text-gray-500 italic mt-1">
                      No notes yet.
                    </p>
                  ))}
              </div>

              {/* Tags */}
              <div>
                <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <TagIcon className="w-3.5 h-3.5" /> Tags
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {idea.tags.map((t) => (
                    <span
                      key={t}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${tagStyle(t)}`}
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        className="hover:opacity-70"
                        aria-label={`Remove ${t}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        commitTagInput();
                      }
                    }}
                    onBlur={commitTagInput}
                    placeholder={idea.tags.length ? "Add tag…" : "e.g. ai, ios, growth"}
                    className="text-sm bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:outline-none focus:border-emerald-500 min-w-[100px] py-0.5 text-gray-700 dark:text-gray-200"
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Triage controls */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Triage
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select
                value={idea.status}
                onChange={(e) => patch({ status: e.target.value })}
                className="mt-1 w-full text-sm"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select
                value={idea.priority}
                onChange={(e) => patch({ priority: e.target.value })}
                className="mt-1 w-full text-sm"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-xs">Value</Label>
              <Select
                value={idea.impact || ""}
                onChange={(e) => patch({ impact: e.target.value })}
                className="mt-1 w-full text-sm"
              >
                {!idea.impact && <option value="">— not set —</option>}
                {IMPACTS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-xs">Effort</Label>
              <Select
                value={idea.complexity || ""}
                onChange={(e) => patch({ complexity: e.target.value })}
                className="mt-1 w-full text-sm"
              >
                {!idea.complexity && <option value="">— not set —</option>}
                {COMPLEXITIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dependencies */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" /> Dependencies
          </h2>

          <div className="space-y-4">
            <div>
              <Label className="text-xs">Blocked by (ship these first)</Label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {idea.blockedBy.length === 0 && (
                  <span className="text-sm text-gray-400 dark:text-gray-500">
                    Nothing — this can start any time.
                  </span>
                )}
                {idea.blockedBy.map((id) => {
                  const ref = idTitle.get(id);
                  const done = ref?.status === "done";
                  return (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                        done
                          ? "bg-gray-100 text-gray-400 line-through dark:bg-gray-800 dark:text-gray-500"
                          : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                      }`}
                    >
                      <Link href={`/ideas/${id}`} className="hover:underline">
                        {ref?.title || "(deleted)"}
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeDep(id)}
                        className="hover:opacity-70"
                        aria-label="Remove dependency"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
              {depOptions.length > 0 && (
                <Select
                  value=""
                  onChange={(e) => addDep(e.target.value)}
                  className="mt-2 w-full sm:w-72 text-sm"
                  aria-label="Add dependency"
                >
                  <option value="">+ Add a blocker…</option>
                  {depOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            {blocks.length > 0 && (
              <div>
                <Label className="text-xs">Blocks (waiting on this)</Label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {blocks.map((r) => (
                    <Link
                      key={r.id}
                      href={`/ideas/${r.id}`}
                      className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 hover:text-emerald-600 dark:bg-gray-800 dark:text-gray-300"
                    >
                      {r.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Implementation scope */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2 gap-2">
            <SectionToggle
              open={isOpen("scope")}
              onClick={() => toggleSection("scope")}
            >
              <span className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                Implementation scope
              </span>
            </SectionToggle>
            <Button
              variant="ghost"
              size="sm"
              onClick={runEstimate}
              disabled={estimating}
            >
              {estimating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Estimating…
                </>
              ) : idea.scope ? (
                "Re-estimate"
              ) : (
                "Estimate the build"
              )}
            </Button>
          </div>
          {isOpen("scope") &&
            (estimating ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Asking the AI to size this up…
              </p>
            ) : idea.scope ? (
              <>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {idea.scope}
                </p>
                {idea.aiEstimatedAt && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    Estimated {new Date(idea.aiEstimatedAt).toLocaleDateString()}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                No estimate yet. Run one to get complexity, value and a build
                breakdown.
              </p>
            ))}
        </CardContent>
      </Card>

      {/* Build prompt (paste-into-agent) */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2 gap-2">
            <SectionToggle
              open={isOpen("plan")}
              onClick={() => toggleSection("plan")}
            >
              <span className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-emerald-600" />
                AI build prompt
              </span>
            </SectionToggle>
            <div className="flex items-center gap-1">
              {idea.plan && (
                <Button size="sm" onClick={copyPlan}>
                  <Copy className="w-4 h-4 mr-1" />
                  {copied ? "Copied!" : "Copy prompt"}
                </Button>
              )}
              <Button
                variant={idea.plan ? "ghost" : "default"}
                size="sm"
                onClick={runPlan}
                disabled={planning}
              >
                {planning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Writing…
                  </>
                ) : idea.plan ? (
                  "Regenerate"
                ) : (
                  "Generate build prompt"
                )}
              </Button>
            </div>
          </div>
          {isOpen("plan") &&
            (planning ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Writing a paste-ready prompt for the coding agent…
              </p>
            ) : idea.plan ? (
              <>
                <pre className="mt-1 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans overflow-auto max-h-[28rem]">
                  {idea.plan}
                </pre>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  Copy this and paste it to Claude Code (or this chat) to build the
                  feature — no edits needed.
                  {idea.plannedAt &&
                    ` · Generated ${new Date(idea.plannedAt).toLocaleDateString()}`}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Turn this idea (and its scope) into a self-contained prompt you can
                paste straight into the coding agent to build it.
              </p>
            ))}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={del}
          disabled={deleting}
          className="text-gray-400 hover:text-red-500"
        >
          <Trash2 className="w-4 h-4 mr-1" />
          {deleting ? "Deleting…" : "Delete idea"}
        </Button>
      </div>
    </div>
  );
}

// A section header that folds its content. The chevron rotates to signal state.
function SectionToggle({
  open,
  onClick,
  children,
}: {
  open: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-left min-w-0"
      aria-expanded={open}
    >
      <ChevronDown
        className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
          open ? "" : "-rotate-90"
        }`}
      />
      {children}
    </button>
  );
}
