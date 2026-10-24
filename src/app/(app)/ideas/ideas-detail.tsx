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
  StoryChild,
  STATUSES,
  PRIORITIES,
  IMPACTS,
  STATUS_STYLES,
  COMPLEXITY_STYLES,
  tagStyle,
  parseTagInput,
  normalizeTags,
  isQuickWin,
} from "./ideas-shared";
import { StoriesSection } from "./ideas-stories";
import { Notice } from "@/components/notice";
import { KindBadge } from "./kind-badge";
import { ReportsPanel } from "./reports-panel";
import { RunPanel } from "./run-panel";
import { IdeaJourney } from "./idea-journey";
import { effectiveSize } from "@/lib/runs/size";
import { sizeExpectation, sizeName } from "@/lib/runs/sizes";

export function IdeaDetail({
  initial,
  allIdeas,
  blocks,
  childStories,
  parent,
  knowledgeNotice = null,
}: {
  initial: Idea;
  allIdeas: IdeaRef[];
  blocks: IdeaRef[];
  childStories: StoryChild[];
  parent: IdeaRef | null;
  knowledgeNotice?: { level: "review" | "stale"; text: string; projectId: string } | null; // the project knowledge needs a look before estimates and plans can be trusted
}) {
  const router = useRouter();
  const [idea, setIdea] = useState<Idea>(initial);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: initial.title,
    notes: initial.notes || "",
    kind: initial.kind || "idea",
    severity: initial.severity || "medium",
    repro: initial.repro || "",
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [copied, setCopied] = useState(false);
  // "Details and overrides" opens by itself for an idea that is (or may become) an Epic, because splitting happens there.
  const [detailsOpen, setDetailsOpen] = useState(() => childStories.length > 0 || initial.complexity === "XL");
  // The journey card asks the stories section to propose a split (an Epic): each press counts up.
  const [splitSignal, setSplitSignal] = useState(0);

  // Open the folded details, then bring one part of them into view (the journey card sends people there).
  const reveal = (id: string) => {
    setDetailsOpen(true);
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "center" }), 60);
  };

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
        const res = await fetch(`/api/ideas/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        // Merge the server's version back so server-derived fields (e.g. closedAt,
        // stamped when status flips to done) reflect immediately.
        if (res.ok) {
          const updated = await res.json();
          setIdea((prev) => ({ ...prev, ...updated }));
        } else {
          setNotice("Could not save that change. Reload the page to see the saved version.");
        }
      } catch {
        setNotice("Could not reach Idea HQ to save that change. Check your connection and try again.");
      }
    },
    [initial.id]
  );

  // Returns the updated idea, or the message to show when it did not work. `quiet`: the caller shows that message itself.
  const runEstimate = useCallback(async (quiet = false): Promise<Idea | string> => {
    setEstimating(true);
    let result: Idea | string;
    try {
      const res = await fetch(`/api/ideas/${initial.id}/estimate`, {
        method: "POST",
      });
      if (res.ok) {
        const updated = await res.json();
        setIdea(updated);
        result = updated;
      } else {
        const d = await res.json().catch(() => null);
        result = d?.error || "The estimate could not be made. Try again in a moment.";
      }
    } catch {
      result = "Could not reach Idea HQ to estimate this idea. Check your connection and try again.";
    } finally {
      setEstimating(false);
    }
    if (typeof result === "string" && !quiet) setNotice(result);
    return result;
  }, [initial.id]);

  const runPlan = useCallback(async (quiet = false): Promise<Idea | string> => {
    setPlanning(true);
    let result: Idea | string;
    try {
      const res = await fetch(`/api/ideas/${initial.id}/plan`, {
        method: "POST",
      });
      if (res.ok) {
        const updated = await res.json();
        setIdea(updated);
        result = updated;
      } else {
        const d = await res.json().catch(() => null);
        result = d?.error || "The plan could not be made. Try again in a moment.";
      }
    } catch {
      result = "Could not reach Idea HQ to make the plan. Check your connection and try again.";
    } finally {
      setPlanning(false);
    }
    if (typeof result === "string" && !quiet) setNotice(result);
    return result;
  }, [initial.id]);

  const startEdit = () => {
    setEditForm({ title: idea.title, notes: idea.notes || "", kind: idea.kind || "idea", severity: idea.severity || "medium", repro: idea.repro || "" });
    setEditing(true);
  };

  const saveEdit = async () => {
    const title = editForm.title.trim();
    if (!title) return;
    const notes = editForm.notes.trim() || null;
    const repro = editForm.kind === "bug" ? editForm.repro.trim() || null : null;
    const severity = editForm.kind === "bug" ? editForm.severity : null;
    const changed = title !== idea.title || notes !== (idea.notes || null);
    setSaving(true);
    setIdea((prev) => ({ ...prev, title, notes, kind: editForm.kind, severity, repro }));
    try {
      const res = await fetch(`/api/ideas/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, notes, kind: editForm.kind, ...(editForm.kind === "bug" ? { severity, repro: repro ?? "" } : {}) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setNotice(d?.error || "Could not save your edit. Your text is still here, so try again.");
        return;
      }
      setEditing(false);
      if (changed) runEstimate();
    } catch {
      setNotice("Could not reach Idea HQ to save your edit. Your text is still here; check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm("Delete this idea? This can't be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ideas/${initial.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("not deleted");
      router.push("/ideas");
      router.refresh();
    } catch {
      setNotice("Could not delete this idea. It is still here; try again in a moment.");
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
      <Notice text={notice} onClose={() => setNotice("")} />
      <Link
        href="/ideas"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400"
      >
        <ArrowLeft className="w-4 h-4" /> Back to ideas
      </Link>

      {parent && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Story in epic:{" "}
          <Link
            href={`/ideas/${parent.id}`}
            className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
          >
            {parent.title}
          </Link>
        </div>
      )}

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
              <fieldset>
                <legend className="text-sm font-medium text-gray-900 dark:text-white">What is it?</legend>
                <div className="mt-1.5 flex flex-wrap gap-4">
                  {[["idea", "An idea"], ["bug", "A bug"]].map(([v, l]) => (
                    <label key={v} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-white">
                      <input type="radio" name="edit-kind" className="h-5 w-5" checked={editForm.kind === v} onChange={() => setEditForm({ ...editForm, kind: v })} />
                      {l}
                    </label>
                  ))}
                </div>
              </fieldset>
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
              {editForm.kind === "bug" && (
                <>
                  <div>
                    <Label htmlFor="edit-repro">Steps to reproduce</Label>
                    <Textarea id="edit-repro" value={editForm.repro} onChange={(e) => setEditForm({ ...editForm, repro: e.target.value })} className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="edit-severity">How bad is it?</Label>
                    <Select id="edit-severity" value={editForm.severity} onChange={(e) => setEditForm({ ...editForm, severity: e.target.value })} className="mt-1.5 w-full sm:w-48">
                      <option value="low">Minor</option>
                      <option value="medium">Normal</option>
                      <option value="high">Serious</option>
                    </Select>
                  </div>
                </>
              )}
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
                    <KindBadge idea={idea} />
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        STATUS_STYLES[idea.status] || STATUS_STYLES.new
                      }`}
                    >
                      {STATUSES.find((s) => s.value === idea.status)?.label ||
                        idea.status}
                    </span>
                    {idea.complexity && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          COMPLEXITY_STYLES[idea.complexity] || COMPLEXITY_STYLES.M
                        }`}
                        title={`${sizeName(idea.complexity)}: ${sizeExpectation(idea.complexity)}`}
                      >
                        {sizeName(idea.complexity)}
                      </span>
                    )}
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {idea.title}
                  </h1>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Added {new Date(idea.createdAt).toLocaleDateString()}
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                      <Label htmlFor="idea-priority" className="text-xs">Priority</Label>
                      <Select id="idea-priority" value={idea.priority} onChange={(e) => patch({ priority: e.target.value })} className="mt-1 w-auto text-sm">
                        {PRIORITIES.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="idea-value" className="text-xs">Value</Label>
                      <Select id="idea-value" value={idea.impact || ""} onChange={(e) => patch({ impact: e.target.value })} className="mt-1 w-auto text-sm">
                        {!idea.impact && <option value="">— not set —</option>}
                        {IMPACTS.map((i) => (
                          <option key={i.value} value={i.value}>
                            {i.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
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

              {idea.kind === "bug" && (
                <div>
                  <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Steps to reproduce</h2>
                  {idea.repro ? (
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-1">{idea.repro}</p>
                  ) : (
                    <p className="text-gray-600 dark:text-gray-400 italic mt-1">No steps yet. Add them with Edit: the AI fixes bugs it can reproduce much more reliably.</p>
                  )}
                </div>
              )}

              <ReportsPanel ideaId={idea.id} status={idea.status} />

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

      {/* The whole idea as one journey, with one button for the next step. The cards below still do everything it does. */}
      {knowledgeNotice && (
        <p role="status" data-testid="knowledge-notice" className="rounded-lg border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          {knowledgeNotice.text}{" "}
          <Link href={`/projects/${knowledgeNotice.projectId}/knowledge`} className="font-semibold underline">{knowledgeNotice.level === "review" ? "Review the suggestions" : "Scan the project again"}</Link>.
        </p>
      )}
      <IdeaJourney
        idea={idea}
        onEstimate={() => runEstimate(true)}
        onPlan={() => runPlan(true)}
        onSplit={() => {
          setSplitSignal((n) => n + 1);
          reveal("stories");
        }}
        onReveal={reveal}
        onSetSize={(value) => patch({ complexity: value })}
        blockedBy={idea.blockedBy.map((id) => idTitle.get(id)).filter((r): r is IdeaRef => !!r && r.status !== "done").map((r) => r.title)}
        onSaveClosure={(text) => patch({ closureNote: text || null })}
      />

      {/* Everything the journey does not need day to day. Nothing here was removed; it is only folded away. */}
      <div>
        <button
          type="button"
          aria-expanded={detailsOpen}
          aria-controls="idea-details"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
        >
          <span>
            Details and overrides
            <span className="block text-xs font-normal text-gray-600 dark:text-gray-400">Status, dependencies, stories, scope, the brief, run options</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${detailsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {/* hidden, not unmounted: the stories proposal and the run panel keep their state while folded */}
        <div id="idea-details" hidden={!detailsOpen} className="mt-4 space-y-4">
      {/* Status: normally moved by the journey; this is the manual override (for example Parked) */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full sm:w-56">
              <Label htmlFor="idea-status" className="text-xs">Status</Label>
              <Select
                id="idea-status"
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
            <p className="text-xs text-gray-600 dark:text-gray-400">The journey above moves this by itself. Change it here to park an idea or to correct it.</p>
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

      {/* Stories (break an epic into ordered child stories) — top-level ideas only */}
      {!parent && (
        <StoriesSection
          ideaId={initial.id}
          complexity={idea.complexity}
          initialChildren={childStories}
          startSignal={splitSignal}
        />
      )}

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
              onClick={() => void runEstimate()}
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
                {idea.complexity && (
                  <p className="mb-2 text-sm text-gray-900 dark:text-white">
                    <b>{sizeName(idea.complexity)}</b>
                    <span className="text-gray-700 dark:text-gray-300">: {sizeExpectation(idea.complexity)}</span>
                  </p>
                )}
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
                No estimate yet. Run one to get the size (turns, minutes and cost
                for the AI), the value and what the build involves.
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
                onClick={() => void runPlan()}
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
                  This is the brief the AI follows when you press Build it. You can also paste it into
                  Claude Code yourself; it has no git steps, so you handle those.
                  {idea.plannedAt &&
                    ` · Generated ${new Date(idea.plannedAt).toLocaleDateString()}`}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Turn this idea (and its scope) into a short brief for the AI that
                builds it: the files to change, the checks to run and what done looks like.
              </p>
            ))}
        </CardContent>
      </Card>

      {/* Implement with AI (GitHub Actions) */}
      <RunPanel ideaId={initial.id} projectId={initial.projectId} plan={idea.plan} size={effectiveSize(idea)} />

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
