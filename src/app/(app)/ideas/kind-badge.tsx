import type { Idea } from "./ideas-shared";

const SEVERITY: Record<string, string> = { low: "minor", medium: "", high: "serious" };

// "Bug" next to the title (the word carries the meaning, colour only supports it).
export function KindBadge({ idea }: { idea: Pick<Idea, "kind" | "severity"> }) {
  if (idea.kind !== "bug") return null;
  const sev = idea.severity ? SEVERITY[idea.severity] : "";
  return (
    <span className="inline-flex items-center rounded-full border border-red-700 px-2 py-0.5 text-xs font-semibold text-red-800 dark:border-red-400 dark:text-red-300">
      Bug{sev ? ` · ${sev}` : ""}
    </span>
  );
}

// How many customers reported it, so the most-reported problems stand out.
export function ReportsChip({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-100" title="Support tickets linked to this">
      {count} report{count === 1 ? "" : "s"}
    </span>
  );
}
