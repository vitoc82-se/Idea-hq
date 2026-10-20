// A plain, visible error line for a screen. Used when a save or load fails, so the
// person always sees what happened and what to do next instead of nothing.
export function Notice({ text, onClose }: { text: string; onClose?: () => void }) {
  if (!text) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-700 bg-red-50 p-3 text-sm text-red-900 dark:border-red-400 dark:bg-red-950/40 dark:text-red-100">
      <p>{text}</p>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 rounded px-2 py-1 font-semibold underline">
          Dismiss
        </button>
      )}
    </div>
  );
}
