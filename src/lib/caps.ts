import { db } from "./db";

import { CAPS } from "./caps-values";
export { CAPS };

const n = (v: number) => v.toLocaleString("en");

// A readable message when a text is longer than allowed, else null.
export function tooLong(label: string, value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > max ? `${label} is too long (at most ${n(max)} characters).` : null;
}

// The first problem in a list of checks, for routes that validate several fields.
export const firstProblem = (...checks: (string | null)[]): string | null => checks.find((c) => c) ?? null;

// https only, and short: where an address is stored it is later fetched or shown as a link.
export function cleanHttpsUrl(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || v.length > CAPS.urlChars) return { ok: false, error: `The address is too long (at most ${CAPS.urlChars} characters).` };
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:") return { ok: false, error: "The address must start with https://" };
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false, error: "That is not a valid web address." };
  }
}

export function cleanColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim();
  return c && c.length <= CAPS.colorChars && /^[#\w(),.% -]+$/.test(c) ? c : null;
}

// Room for more projects / ideas: a message when the limit would be passed, else null.
export async function projectRoom(userId: string): Promise<string | null> {
  const have = await db.project.count({ where: { userId } });
  return have >= CAPS.projectsPerUser ? `You have reached the limit of ${CAPS.projectsPerUser} projects. Delete one you no longer need first.` : null;
}

export async function ideaRoom(projectId: string, adding = 1): Promise<string | null> {
  const have = await db.idea.count({ where: { projectId } });
  return have + adding > CAPS.ideasPerProject
    ? `This project has ${n(have)} ideas and the limit is ${n(CAPS.ideasPerProject)}. Close or delete some before adding more.`
    : null;
}
