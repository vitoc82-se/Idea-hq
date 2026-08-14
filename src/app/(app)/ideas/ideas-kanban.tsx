"use client";

import { useState } from "react";
import Link from "next/link";
import { Star, Link2 } from "lucide-react";
import {
  Idea,
  STATUSES,
  PRIORITY_STYLES,
  IMPACT_STYLES,
  COMPLEXITY_STYLES,
  tagStyle,
  isQuickWin,
} from "./ideas-shared";

// A simple drag-and-drop kanban: columns are statuses; dropping a card in a
// column changes its status. Uses native HTML5 drag events (no library).
export function KanbanBoard({
  ideas,
  blockedIds,
  onStatus,
}: {
  ideas: Idea[];
  blockedIds: Set<string>;
  onStatus: (id: string, status: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const drop = (status: string) => {
    if (dragId) {
      const cur = ideas.find((i) => i.id === dragId);
      if (cur && cur.status !== status) onStatus(dragId, status);
    }
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {STATUSES.map((col) => {
        const items = ideas.filter((i) => i.status === col.value);
        return (
          <div
            key={col.value}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.value);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.value ? null : c))}
            onDrop={() => drop(col.value)}
            className={`rounded-lg border p-2 min-h-[120px] transition-colors ${
              overCol === col.value
                ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-600 dark:bg-emerald-900/10"
                : "border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/30"
            }`}
          >
            <div className="flex items-center justify-between px-1 py-1.5 mb-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                {col.label}
              </span>
              <span className="text-xs text-gray-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((idea) => (
                <div
                  key={idea.id}
                  draggable
                  onDragStart={() => setDragId(idea.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                  }}
                  className={`rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 shadow-sm cursor-grab active:cursor-grabbing ${
                    dragId === idea.id ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    {isQuickWin(idea) && (
                      <Star
                        className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5"
                        aria-label="Quick win"
                      />
                    )}
                    {blockedIds.has(idea.id) && (
                      <Link2
                        className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5"
                        aria-label="Blocked by another idea"
                      />
                    )}
                    <Link
                      href={`/ideas/${idea.id}`}
                      className="text-sm font-medium text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 leading-snug"
                    >
                      {idea.title}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    {idea.priority !== "none" && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${PRIORITY_STYLES[idea.priority]}`}
                      >
                        {idea.priority}
                      </span>
                    )}
                    {idea.impact && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${IMPACT_STYLES[idea.impact]}`}
                      >
                        {idea.impact}
                      </span>
                    )}
                    {idea.complexity && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          COMPLEXITY_STYLES[idea.complexity] || COMPLEXITY_STYLES.M
                        }`}
                      >
                        {idea.complexity}
                      </span>
                    )}
                    {idea.tags.slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${tagStyle(t)}`}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-xs text-gray-300 dark:text-gray-600 px-1 py-2">
                  Drop here
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
