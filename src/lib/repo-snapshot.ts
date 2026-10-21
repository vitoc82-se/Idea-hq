import { type GitHubApi } from "@/lib/github/client";

// A compact picture of a repo for the AI: what kind of project it is, how it is
// laid out, and the handful of files that explain it. Works from the full file
// list (one GitHub request), so it does not depend on a fixed folder layout.

export type Snapshot = {
  ecosystems: string[];
  outline: string[]; // folders with file counts
  files: { path: string; text: string }[];
  totalFiles: number;
  truncated: boolean;
};

const SKIP = /(^|\/)(node_modules|dist|build|out|vendor|\.next|\.git|coverage|__pycache__|\.venv|venv|target|\.turbo|\.cache)\//;
const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|pdf|zip|gz|mp4|mov|mp3|wasm|lock|map|min\.js)$/i;
const LOCK = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/;
// Files that hold (or usually hold) secrets: never shown to the AI and never listed.
const SECRETISH = new RegExp(
  "(^|/)(" +
    [
      "\\.env(\\..*)?", ".*\\.env", // .env, .env.local, prod.env
      ".*\\.pem", ".*\\.key", ".*\\.p12", ".*\\.pfx", ".*\\.jks", ".*\\.keystore", ".*\\.kdbx", ".*\\.gpg", ".*\\.asc", // keys and stores
      "id_(rsa|dsa|ecdsa|ed25519).*", "\\.ssh", // ssh
      ".*\\.tfvars", ".*\\.tfstate(\\.backup)?", // Terraform values and state
      "\\.npmrc", "\\.pypirc", "\\.netrc", "\\.git-credentials", "\\.dockercfg", "\\.htpasswd", "\\.pgpass", "\\.vault[-_]?pass.*", "kubeconfig", // tool configs with tokens
      "service[-_]?account.*\\.json", ".*adminsdk.*\\.json", // cloud service accounts
      ".*secret.*", ".*credentials.*",
    ].join("|") +
    ")$",
  "i"
);
// Folders that are secret as a whole.
const SECRET_DIRS = /(^|\/)(\.ssh|\.aws|\.gnupg|\.kube|secrets?)\//i;
const EXAMPLE_ENV = /\.env\.(example|sample|template)$/i;

export function isReadable(path: string): boolean {
  if (SKIP.test(path) || BINARY.test(path) || LOCK.test(path)) return false;
  if (SECRET_DIRS.test(path)) return false;
  if (SECRETISH.test(path) && !EXAMPLE_ENV.test(path)) return false;
  return true;
}

const MANIFESTS: [RegExp, string][] = [
  [/^package\.json$/, "JavaScript/TypeScript (Node)"],
  [/^requirements\.txt$|^pyproject\.toml$|^Pipfile$|^setup\.py$/, "Python"],
  [/^go\.mod$/, "Go"],
  [/^Cargo\.toml$/, "Rust"],
  [/^Gemfile$/, "Ruby"],
  [/^composer\.json$/, "PHP"],
  [/^pom\.xml$|^build\.gradle(\.kts)?$/, "Java/Kotlin"],
  [/^Package\.swift$|\.xcodeproj\//, "Swift/iOS"],
  [/^pubspec\.yaml$/, "Dart/Flutter"],
];

export function detectEcosystems(paths: string[]): string[] {
  const found = new Set<string>();
  for (const p of paths) {
    for (const [re, name] of MANIFESTS) if (re.test(p)) found.add(name);
    if (/^next\.config\./.test(p)) found.add("Next.js");
    if (/^pages\//.test(p) && /\.(jsx?|tsx?)$/.test(p)) found.add("Next.js (pages router)");
    if (/^(src\/)?app\/.*(page|route|layout)\.(jsx?|tsx?)$/.test(p)) found.add("Next.js (app router)");
    if (/prisma\/schema\.prisma$/.test(p)) found.add("Prisma");
    if (/^Dockerfile$/.test(p)) found.add("Docker");
    if (/^vercel\.json$/.test(p)) found.add("Vercel");
    if (/manage\.py$/.test(p)) found.add("Django");
  }
  return Array.from(found);
}

// Lower score = read first. Files that explain intent come before files that
// show structure, and a few examples of code come last.
function score(path: string): number | null {
  const base = path.split("/").pop() || path;
  const depth = path.split("/").length - 1;
  if (/^(README|readme)(\.md|\.rst|\.txt)?$/.test(base) && depth === 0) return 0;
  if (/^(CLAUDE|AGENTS|ARCHITECTURE|DEVELOPMENT|CONTRIBUTING|PRODUCT|SPEC)\.md$/i.test(base) && depth <= 1) return 1;
  if (path === ".idea-hq/KNOWLEDGE.md") return 1;
  if (/^docs\/.+\.(md|mdx)$/i.test(path) && depth <= 2) return 3;
  if (depth === 0 && /^(package\.json|pyproject\.toml|requirements\.txt|Pipfile|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|Package\.swift|pubspec\.yaml)$/.test(base)) return 2;
  if (/prisma\/schema\.prisma$|(^|\/)schema\.(sql|graphql)$|(^|\/)models?\.py$|drizzle\.config\./.test(path)) return 4;
  if (depth === 0 && /^(next\.config\.[a-z]+|vercel\.json|Dockerfile|docker-compose\.ya?ml|\.env\.(example|sample|template)|tailwind\.config\.[a-z]+)$/.test(base)) return 5;
  if (/^\.github\/workflows\/.+\.ya?ml$/.test(path)) return 6;
  if (/^(pages\/(index|_app)|(src\/)?app\/(layout|page)|src\/(main|index)|index|main|app|server|manage)\.(jsx?|tsx?|py|go|rb|rs)$/.test(path)) return 7;
  if (/^(pages\/api\/|(src\/)?app\/api\/).+\.(jsx?|tsx?)$/.test(path)) return 8;
  if (/^(lib|src\/lib|utils|src\/utils|services|src\/services)\/[^/]+\.(jsx?|tsx?|py)$/.test(path)) return 9;
  return null;
}

export function pickFiles(paths: string[], max = 16): string[] {
  const scored: { p: string; s: number }[] = [];
  for (const p of paths) {
    if (!isReadable(p)) continue;
    const s = score(p);
    if (s !== null) scored.push({ p, s });
  }
  scored.sort((a, b) => a.s - b.s || a.p.length - b.p.length || a.p.localeCompare(b.p));
  // Keep a few of each low-priority kind so one big folder cannot crowd out the rest.
  const perScoreCap: Record<number, number> = { 3: 3, 4: 3, 6: 2, 7: 4, 8: 3, 9: 3 };
  const used: Record<number, number> = {};
  const out: string[] = [];
  for (const { p, s } of scored) {
    used[s] = (used[s] || 0) + 1;
    if (perScoreCap[s] && used[s] > perScoreCap[s]) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

export function buildOutline(paths: string[], maxLines = 70): string[] {
  const counts = new Map<string, number>();
  for (const p of paths) {
    if (!isReadable(p) && !SECRETISH.test(p) && !SECRET_DIRS.test(p)) continue;
    const parts = p.split("/");
    if (parts.length === 1) continue;
    const key = parts.length > 2 ? `${parts[0]}/${parts[1]}/` : `${parts[0]}/`;
    counts.set(key, (counts.get(key) || 0) + 1);
    const top = `${parts[0]}/`;
    if (key !== top) counts.set(top, counts.get(top) || 0);
  }
  const rootFiles = paths.filter((p) => !p.includes("/") && isReadable(p)).slice(0, 25);
  const dirs = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([d, n]) => (n ? `${d} (${n} files)` : d));
  return [...rootFiles, ...dirs].slice(0, maxLines);
}

const PER_FILE = 6000;
const TOTAL = 48000;

export async function snapshotRepo(gh: GitHubApi, i: number, owner: string, repo: string, ref: string): Promise<Snapshot> {
  const { paths, truncated } = await gh.listTree(i, owner, repo, ref).catch(() => ({ paths: [] as string[], truncated: false }));
  const picks = pickFiles(paths);
  const fetched = await Promise.all(
    picks.map(async (p) => {
      const f = await gh.getFile(i, owner, repo, p, ref).catch(() => null);
      return f ? { path: p, text: f.content } : null;
    })
  );
  const files: Snapshot["files"] = [];
  let used = 0;
  for (const f of fetched) {
    if (!f) continue;
    let text = f.text.length > PER_FILE ? `${f.text.slice(0, PER_FILE)}\n…(truncated)` : f.text;
    if (used + text.length > TOTAL) text = text.slice(0, Math.max(0, TOTAL - used));
    if (!text.trim()) continue;
    used += text.length;
    files.push({ path: f.path, text });
  }
  return { ecosystems: detectEcosystems(paths), outline: buildOutline(paths), files, totalFiles: paths.length, truncated };
}
