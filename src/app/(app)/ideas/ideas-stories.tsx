"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Loader2, X, Plus, ChevronRight, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  StoryChild,
  COMPLEXITIES,
  STATUS_STYLES,
  COMPLEXITY_STYLES,
  statusLabel,
} from "./ideas-shared";
import { sizeName } from "@/lib/runs/sizes";

type ProposedStory = {
  title: string;
  notes: string | null;
  complexity: string;
  impact: string | null;
  scope: string | null;
};

type Proposal =
  | { kind: "stories"; summary: string; stories: ProposedStory[]; existingChildren: number }
  | { kind: "process"; summary: string; reason: string; checklist: string[]; existingChildren: number };

// Draft rows the user can edit / drop before committing.
type Draft = ProposedStory & { include: boolean };

export function StoriesSection({
  ideaId,
  complexity,
  initialChildren,
}: {
  ideaId: string;
  complexity: string | null;
  initialChildren: StoryChild[];
}) {
  const router = useRouter();
  const [children, setChildren] = useState<StoryChild[]>(initialChildren);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasChildren = children.length > 0;
  const suggested = complexity === "L" || complexity === "XL";
  const doneCount = children.filter((c) => c.status === "done").length;

  const propose = async () => {
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      const res = await fetch(`/api/ideas/${ideaId}/breakdown`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Breakdown failed");
        return;
      }
      setProposal(data);
      if (data.kind === "stories") {
        setDrafts(data.stories.map((s: ProposedStory) => ({ ...s, include: true })));
      }
    } catch {
      setError("Could not reach Idea HQ to create the stories. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    const stories = drafts
      .filter((d) => d.include && d.title.trim())
      .map((d) => ({
        title: d.title,
        notes: d.notes,
        complexity: d.complexity,
        impact: d.impact,
        scope: d.scope,
      }));
    if (stories.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/ideas/${ideaId}/breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: true, stories, replace: hasChildren }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Could not create the stories. Try again in a moment.");
        return;
      }
      const created: StoryChild[] = (data.children || []).map((c: StoryChild) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        complexity: c.complexity,
        impact: c.impact,
      }));
      setChildren(created);
      setProposal(null);
      setDrafts([]);
      router.refresh(); // sync the board/epic badge + rolled-up status
    } catch {
      setError("Could not reach Idea HQ to create the stories. Check your connection and try again.");
    } finally {
      setCommitting(false);
    }
  };

  const updateDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-violet-600" />
            Stories
            {hasChildren && (
              <span className="text-xs text-gray-400 font-normal">
                · {doneCount}/{children.length} done
              </span>
            )}
          </h2>
          {(hasChildren || !proposal) && (
            <Button
              variant={suggested && !hasChildren ? "default" : "ghost"}
              size="sm"
              onClick={propose}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Thinking…
                </>
              ) : hasChildren ? (
                "Regenerate"
              ) : (
                <>
                  <Layers className="w-4 h-4 mr-1" /> Break into stories
                </>
              )}
            </Button>
          )}
        </div>

        {/* Existing children */}
        {hasChildren && !proposal && (
          <div className="space-y-1.5">
            {children.map((c, i) => (
              <Link
                key={c.id}
                href={`/ideas/${c.id}`}
                className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors group"
              >
                <span className="text-xs text-gray-400 tabular-nums w-5 shrink-0">{i + 1}</span>
                <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                  {c.title}
                </span>
                {c.complexity && (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                      COMPLEXITY_STYLES[c.complexity] || COMPLEXITY_STYLES.M
                    }`}
                  >
                    {sizeName(c.complexity)}
                  </span>
                )}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    STATUS_STYLES[c.status] || STATUS_STYLES.new
                  }`}
                >
                  {statusLabel(c.status)}
                </span>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </Link>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!hasChildren && !proposal && !loading && (
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {suggested
              ? "This looks big. Break it into small, ordered stories an AI agent can build one at a time."
              : "Split this into smaller ordered stories, each buildable in one agent session."}
          </p>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {/* Process proposal — not code, don't create stories */}
        {proposal?.kind === "process" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800">
              <ClipboardList className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">This is a process, not code.</p>
                <p className="mt-0.5">{proposal.reason || proposal.summary}</p>
              </div>
            </div>
            <ul className="space-y-1.5">
              {proposal.checklist.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="text-gray-400 tabular-nums shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              No stories were created — this needs real-world steps, not build prompts.
            </p>
            <Button variant="outline" size="sm" onClick={() => setProposal(null)}>
              Dismiss
            </Button>
          </div>
        )}

        {/* Stories proposal — editable preview before saving */}
        {proposal?.kind === "stories" && (
          <div className="space-y-3">
            {proposal.summary && (
              <p className="text-sm text-gray-500 dark:text-gray-400">{proposal.summary}</p>
            )}
            {drafts.map((d, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 space-y-2 ${
                  d.include
                    ? "border-gray-200 dark:border-gray-700"
                    : "border-gray-100 dark:border-gray-800 opacity-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 tabular-nums">{i + 1}</span>
                  <Input
                    value={d.title}
                    onChange={(e) => updateDraft(i, { title: e.target.value })}
                    className="flex-1 text-sm"
                  />
                  <Select
                    value={d.complexity}
                    onChange={(e) => updateDraft(i, { complexity: e.target.value })}
                    className="w-16 text-sm shrink-0"
                    aria-label="Effort"
                  >
                    {COMPLEXITIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => updateDraft(i, { include: !d.include })}
                    className="text-gray-400 hover:text-red-500 shrink-0"
                    aria-label={d.include ? "Drop this story" : "Keep this story"}
                    title={d.include ? "Drop this story" : "Keep this story"}
                  >
                    {d.include ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </button>
                </div>
                {d.include && (
                  <Textarea
                    value={d.notes || ""}
                    onChange={(e) => updateDraft(i, { notes: e.target.value })}
                    className="text-xs min-h-[52px]"
                    placeholder="Notes / scope for this story"
                  />
                )}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={commit} disabled={committing}>
                {committing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Creating…
                  </>
                ) : hasChildren ? (
                  `Replace with ${drafts.filter((d) => d.include).length} stories`
                ) : (
                  `Create ${drafts.filter((d) => d.include).length} stories`
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setProposal(null)}>
                Cancel
              </Button>
              {hasChildren && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  Replaces the current {children.length} stories.
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
