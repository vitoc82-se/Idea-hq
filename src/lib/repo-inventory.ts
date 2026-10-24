import type { GitHubApi } from "@/lib/github/client";

// A plain list of what a repository contains, by name: every data model, page, API route, code folder, library and
// scheduled job. A summary written by hand or by a scan is short and goes stale; this is read from the repository itself,
// so an AI estimating an idea can see that "support tickets" or "a daily job" already exist instead of concluding they
// do not because a summary did not mention them.

const SCHEMA = /(^|\/)schema\.prisma$/;
const MAX_INVENTORY = 9000;

// "model Ticket: id, projectId, subject, ... (+8 more)": every model, with its field names only.
export function summarizePrismaSchema(text: string, perModel = 14, maxChars = 6000): string {
  const lines: string[] = [];
  for (const m of text.matchAll(/^\s*(model|enum|type)\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
    const names = m[3]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s+/)[0])
      .filter((n) => /^\w+$/.test(n));
    const shown = names.slice(0, perModel).join(", ");
    lines.push(`${m[1]} ${m[2]}: ${shown}${names.length > perModel ? `, ... (+${names.length - perModel} more)` : ""}`);
  }
  let out = "";
  for (const l of lines) {
    if (out.length + l.length + 1 > maxChars) { out += `\n... (+${lines.length - out.split("\n").length + 1} more models)`; break; }
    out += (out ? "\n" : "") + l;
  }
  return out;
}

const dropGroups = (segments: string[]) => segments.filter((s) => !/^\(.*\)$/.test(s) && !/^@/.test(s));

// The pages and API routes a Next.js app serves, from the file list alone.
export function routesFrom(paths: string[]): { pages: string[]; api: string[] } {
  const pages = new Set<string>();
  const api = new Set<string>();
  for (const p of paths) {
    let m = /^(?:src\/)?app\/(?:(.*)\/)?(page|route)\.(?:tsx?|jsx?|mdx)$/.exec(p);
    if (m) {
      const route = "/" + dropGroups((m[1] ?? "").split("/").filter(Boolean)).join("/");
      (m[2] === "route" ? api : pages).add(route === "/" ? "/" : route);
      continue;
    }
    m = /^(?:src\/)?pages\/(.+)\.(?:tsx?|jsx?)$/.exec(p);
    if (m && !/(^|\/)_(app|document|error)$/.test(m[1])) {
      const route = "/" + m[1].replace(/\/index$/, "").replace(/^index$/, "");
      (route.startsWith("/api/") || route === "/api" ? api : pages).add(route === "/" ? "/" : route.replace(/\/$/, ""));
    }
  }
  return { pages: [...pages].sort(), api: [...api].sort() };
}

// "src/lib/support: ai, form-schema, ..." for the folders where the logic lives.
export function codeFoldersFrom(paths: string[], maxLines = 70): string[] {
  const dirs = new Map<string, string[]>();
  for (const p of paths) {
    const m = /^((?:src\/)?(?:lib|services|utils|server|components)(?:\/[^/]+)*)\/([^/]+)\.(?:tsx?|jsx?|py|go|rb|rs)$/.exec(p);
    if (!m || /\.(test|spec)\./.test(p)) continue;
    dirs.set(m[1], [...(dirs.get(m[1]) ?? []), m[2]]);
  }
  return [...dirs.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, maxLines).map(([d, names]) => `${d}: ${names.sort().slice(0, 40).join(", ")}${names.length > 40 ? ", ..." : ""}`);
}

function dependencyNames(packageJson: string | undefined): string[] {
  if (!packageJson) return [];
  try {
    const j = JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return [...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})].sort();
  } catch {
    return [];
  }
}

function cronsFrom(vercelJson: string | undefined): string[] {
  if (!vercelJson) return [];
  try {
    const j = JSON.parse(vercelJson) as { crons?: { path?: string; schedule?: string }[] };
    return (j.crons ?? []).filter((c) => c.path).map((c) => `${c.path} (${c.schedule ?? "scheduled"})`);
  } catch {
    return [];
  }
}

export type InventoryInput = { paths: string[]; truncated?: boolean; texts: Record<string, string | undefined> };

export function buildInventory({ paths, truncated, texts }: InventoryInput): string {
  const parts: string[] = [];
  const schemaPath = paths.find((p) => SCHEMA.test(p));
  const schema = schemaPath ? texts[schemaPath] : undefined;
  if (schema) parts.push(`Data models (${schemaPath}), with their fields:\n${summarizePrismaSchema(schema)}`);
  const { pages, api } = routesFrom(paths);
  if (pages.length) parts.push(`Pages (${pages.length}):\n${pages.slice(0, 120).join("\n")}${pages.length > 120 ? "\n..." : ""}`);
  if (api.length) parts.push(`API routes (${api.length}):\n${api.slice(0, 160).join("\n")}${api.length > 160 ? "\n..." : ""}`);
  const folders = codeFoldersFrom(paths);
  if (folders.length) parts.push(`Code, by folder:\n${folders.join("\n")}`);
  const deps = dependencyNames(texts["package.json"]);
  if (deps.length) parts.push(`Libraries in package.json:\n${deps.slice(0, 100).join(", ")}`);
  const crons = cronsFrom(texts["vercel.json"]);
  if (crons.length) parts.push(`Scheduled jobs (vercel.json):\n${crons.join("\n")}`);
  const workflows = paths.filter((p) => /^\.github\/workflows\/.+\.ya?ml$/.test(p));
  if (workflows.length) parts.push(`GitHub workflows:\n${workflows.join("\n")}`);
  let out = parts.join("\n\n");
  if (truncated) out += "\n\n(The file list was cut short by GitHub: there may be more files than shown.)";
  return out.length > MAX_INVENTORY ? `${out.slice(0, MAX_INVENTORY)}\n...(cut)` : out;
}

// The files whose full text the inventory needs (a handful of requests, not the whole repo).
export function inventoryFiles(paths: string[]): string[] {
  return [paths.find((p) => SCHEMA.test(p)), paths.includes("package.json") ? "package.json" : undefined, paths.includes("vercel.json") ? "vercel.json" : undefined].filter((p): p is string => !!p);
}

const cache = new Map<string, string>();
const CACHE_MAX = 40;

// The live inventory of a project's repository, for an AI that is about to estimate or plan an idea. Cached per commit
// (the same commit always gives the same list), and never allowed to hold the answer up for long or to fail it: no
// inventory just means the AI works from the summary alone.
export async function liveInventory(gh: GitHubApi, i: number, owner: string, repo: string, ref: string, timeoutMs = 6000): Promise<string | null> {
  const work = (async () => {
    const head = await gh.repoBranch(i, owner, repo, ref);
    const key = `${owner}/${repo}@${head?.sha ?? ref}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const tree = await gh.listTree(i, owner, repo, ref);
    if (!tree.paths.length) return null;
    const texts: Record<string, string | undefined> = {};
    await Promise.all(inventoryFiles(tree.paths).map(async (p) => { texts[p] = (await gh.getFile(i, owner, repo, p, ref).catch(() => null))?.content; }));
    const inv = buildInventory({ paths: tree.paths, truncated: tree.truncated, texts });
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, inv);
    return inv;
  })();
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([work, late]).catch(() => null);
}
