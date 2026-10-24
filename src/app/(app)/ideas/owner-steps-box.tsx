"use client";

import { useId, useState } from "react";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { helpFor, stepsLeft, type OwnerStep } from "@/lib/runs/owner-steps";

const SOURCE: Record<OwnerStep["source"], string> = {
  plan: "From the plan",
  ai: "The AI said so",
  code: "Idea HQ found this in the change",
};

// What the owner has to do outside the code, as a checklist. It is shown from the plan to the end because the same
// list matters at three moments: before building (what is coming), before merging (do these so the deploy works) and
// after merging (the idea is not finished until they are done).
export function OwnerStepsBox({ steps, stage, onSet }: { steps: OwnerStep[]; stage: "plan" | "review" | "ship"; onSet: (id: string, state: "done" | "skipped" | "open") => Promise<string | null> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  if (!steps.length) return null;

  const left = stepsLeft(steps);
  const before = steps.filter((s) => s.when === "before");
  const after = steps.filter((s) => s.when === "after");

  const set = async (id: string, state: "done" | "skipped" | "open") => {
    setBusy(id); setError(null);
    const e = await onSet(id, state);
    if (e) setError(e);
    setBusy(null);
  };

  const heading =
    stage === "ship" ? (left.length ? "Finish these so it works" : "Setup steps: all done")
    : stage === "review" ? "Things only you can do"
    : "Heads up: you will have to do a few things yourself";
  const intro =
    stage === "ship" ? (left.length ? "The change is live, but it needs the steps below. The AI cannot do them for you." : "You ticked every step. Nothing more is needed.")
    : stage === "review" ? "The AI cannot do these, because they happen outside the code (on your host, in a dashboard, on another website). Do the ones under Before you merge first, so the live site works the moment it updates."
    : "The plan says this idea needs the steps below. You do not have to do them now. Nothing is lost if you wait until the change is built, and they will be here again at Review.";

  const group = (title: string, list: OwnerStep[], note: string) =>
    list.length > 0 && (
      <div className="space-y-2">
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{title}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400">{note}</p>
        </div>
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.id} className="rounded-lg border border-gray-300 p-3 dark:border-gray-600" data-testid="owner-step">
              <div className="flex items-start gap-3">
                <input
                  id={`${uid}-${s.id}`}
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 accent-emerald-700"
                  checked={s.done}
                  disabled={busy !== null}
                  onChange={(e) => void set(s.id, e.target.checked ? "done" : "open")}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <label htmlFor={`${uid}-${s.id}`} className={`block cursor-pointer text-sm ${s.done ? "text-gray-600 line-through dark:text-gray-400" : "text-gray-900 dark:text-white"}`}>
                    {s.text}
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {SOURCE[s.source]}
                    {s.skipped ? " · marked Not needed" : s.done ? " · done" : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {!s.done && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void set(s.id, "skipped")}>
                        Not needed<span className="sr-only">: {s.text.slice(0, 60)}</span>
                      </Button>
                    )}
                  </div>
                  <Help text={s.text} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div id="owner-steps" tabIndex={-1} className="space-y-3 rounded-xl border border-amber-600 bg-amber-50/60 p-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-amber-500 dark:bg-amber-950/20" data-testid="owner-steps">
      <div className="flex items-start gap-2">
        <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-amber-800 dark:text-amber-400" aria-hidden="true" />
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{heading}</p>
          <p className="text-gray-700 dark:text-gray-300">{intro}</p>
          {stage !== "ship" && left.length > 0 && <p className="mt-1 text-xs text-gray-700 dark:text-gray-300" role="status">{left.length} left to do.</p>}
        </div>
      </div>
      {stage === "ship"
        ? group("Meant for before the merge", before, "Do these now. If one is a setting, redeploy your site afterwards so it picks the setting up.")
        : group("Before you merge", before, "Do these first. If you merge without them, the live site may break.")}
      {stage === "ship"
        ? group("Now that it is live", after, "These can only be done once the change is live, so now is the time.")
        : group("After you merge", after, "These can only be done once the change is live.")}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

function Help({ text }: { text: string }) {
  const h = helpFor(text);
  return (
    <details className="text-sm text-gray-800 dark:text-gray-200">
      <summary className="cursor-pointer text-emerald-800 underline dark:text-emerald-400">How do I do this?</summary>
      <div className="mt-2 space-y-1 rounded-lg bg-white/70 p-3 dark:bg-gray-900/40">
        <p className="font-medium">{h.title}</p>
        <ol className="list-decimal space-y-1 pl-5">
          {h.steps.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}
