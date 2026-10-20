// The types of entry on a What's new page. Plain constants, safe for the browser and the public page.
export const ENTRY_KINDS = ["new", "fix", "improved"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_KIND_LABEL: Record<EntryKind, string> = { new: "New", fix: "Fixed", improved: "Improved" };
