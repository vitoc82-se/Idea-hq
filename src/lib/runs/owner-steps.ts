import { cleanText } from "../support/sanitize";

// Things only the owner can do for a change to work once it is merged: set an environment variable, create a key or an
// account, change a setting on the host, run a one-off script. The AI cannot do them (it never sees secrets and cannot
// change the host), so they are collected from three places and shown as a checklist before Merge and after Ship:
//   plan  the planning AI says what the idea will need
//   ai    the building AI says what its change needs (an OWNER STEPS block at the start of its final message)
//   code  Idea HQ reads the change itself and finds environment variables that are new (see envStepsFromChanges)

export type StepSource = "plan" | "ai" | "code";
export type StepWhen = "before" | "after";

export type OwnerStep = {
  id: string;
  text: string;
  when: StepWhen; // before: do it before you merge, so the deploy works. after: do it once the change is live
  source: StepSource;
  done: boolean;
  skipped?: boolean; // "Not needed": the owner says it does not apply (an environment variable that is already set)
  doneAt?: string;
};

export const STEPS_MAX = 20;
export const STEP_TEXT_MAX = 600;

// The header the planning AI writes, and the one the building AI writes. The same step lines follow either.
export const PLAN_STEPS_HEADER = /^#{1,6}\s*steps only (?:you|the owner) can do\b.*$/i;
export const BUILD_STEPS_HEADER = /^[\s>*_`#-]*owner steps\b[\s*_`]*:?[\s*_`]*(.*)$/i;

// A short stable id from what the step says, so the same step found again keeps its tick. A plain hash (FNV-1a) rather
// than node:crypto, because the board and the idea page use this file in the browser too.
export function stepId(source: StepSource, text: string): string {
  const norm = `${source}|${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) h = Math.imul(h ^ norm.charCodeAt(i), 0x01000193);
  return `${source[0]}${(h >>> 0).toString(16).padStart(8, "0")}`;
}

const LINE = /^[\s>*•\-\d.)]*\**\s*(before|after)(?:\s+the)?\s+(?:merge|merging)\**\s*[:\-–—]\s*\**\s*(.*)$/i;

function makeStep(source: StepSource, when: StepWhen, text: string): OwnerStep | null {
  const t = cleanText(text.replace(/[*`]+/g, "").replace(/\s+/g, " "), STEP_TEXT_MAX);
  if (t.length < 4) return null;
  return { id: stepId(source, t), text: t, when, source, done: false };
}

// Reads step lines ("BEFORE MERGE: ..." or "AFTER MERGE: ...") that follow a header line, until a blank line ends the
// list. A line that continues the one above (no keyword) is joined to it. "none" or "nothing" after the header means
// there are no steps. Returns [] when there is no block at all.
export function parseStepLines(lines: string[], source: StepSource): OwnerStep[] {
  const out: OwnerStep[] = [];
  let cur: { when: StepWhen; text: string } | null = null;
  const flush = () => {
    if (cur) {
      const s = makeStep(source, cur.when, cur.text);
      if (s && !out.some((o) => o.id === s.id)) out.push(s);
    }
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) {
      if (cur || out.length) break;
      continue;
    }
    const m = LINE.exec(line);
    if (m) {
      flush();
      cur = { when: m[1].toLowerCase() === "after" ? "after" : "before", text: m[2] };
    } else if (cur && !/^\s*#{1,6}\s/.test(line)) {
      cur.text += ` ${line.trim()}`;
    } else break;
    if (out.length >= STEPS_MAX) break;
  }
  flush();
  return out.slice(0, STEPS_MAX);
}

// The building AI puts "OWNER STEPS" first in its final message (the end of a long message can be cut off on the way
// back), then one line per step. "OWNER STEPS: none" says there are none. null: the message has no such block at all,
// which is not the same as "none" (a revision may say nothing about it) and must not wipe the list from the first build.
export function parseBuildSteps(note: string | null | undefined): OwnerStep[] | null {
  if (!note) return null;
  const lines = note.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = BUILD_STEPS_HEADER.exec(lines[i]);
    if (!h) continue;
    if (/^(none|nothing|no steps?|n\/a)\b/i.test(h[1].trim())) return [];
    const rest = h[1].trim() ? [h[1], ...lines.slice(i + 1)] : lines.slice(i + 1);
    return parseStepLines(rest, "ai");
  }
  return null;
}

// The AI's message without its OWNER STEPS block, for the places that show or quote what it said (the checklist already
// shows the steps, and the closing note should start with what changed, not with a to-do list).
export function withoutStepsBlock(note: string): string {
  const lines = note.split("\n");
  const at = lines.findIndex((l) => BUILD_STEPS_HEADER.test(l));
  if (at < 0) return note;
  let end = at + 1;
  while (end < lines.length && lines[end].trim() && (LINE.test(lines[end]) || /^\s+\S/.test(lines[end]) || (end === at + 1 && /^[\s>*•\-]*(none|nothing|no steps?)\b/i.test(lines[end])))) end++;
  return [...lines.slice(0, at), ...lines.slice(end)].join("\n").replace(/^\s+/, "").replace(/\n{3,}/g, "\n\n");
}

// The planning AI ends the build prompt with "## Steps only you can do". The section is taken out of the prompt (the
// building AI is told the owner does these, so they do not belong in its brief) and returned as steps.
export function splitPlanSteps(plan: string): { plan: string; steps: OwnerStep[] } {
  const lines = plan.split("\n");
  const at = lines.findIndex((l) => PLAN_STEPS_HEADER.test(l.trim()));
  if (at < 0) return { plan, steps: [] };
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i]) || /^_Written after reading/i.test(lines[i].trim())) { end = i; break; }
  }
  const section = lines.slice(at + 1, end);
  const none = section.find((l) => l.trim());
  const steps = !none || /^[\s>*•\-]*(none|nothing|no steps?)\b/i.test(none) ? [] : parseStepLines(section, "plan");
  const kept = [...lines.slice(0, at), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { plan: kept, steps };
}

// What the planning AI is asked, added to the end of the plan prompt.
export function planStepsAsk(): string {
  return `After the brief, add a last section with the exact heading "## Steps only you can do" for anything the OWNER must do outside the code for this to work once it is merged, because the coding agent cannot: set a new environment variable (name it exactly, never write a value), create an account or an API key at another service, change a setting on the host or in a dashboard, add a DNS record, or run a one-off script or database change by hand. Write one line per step, starting with "BEFORE MERGE:" (it must be done before the merge so the deploy works) or "AFTER MERGE:" (it can only be done once the change is live), then plain words a person who is not technical can follow, saying where to do it. If there is nothing like that, write the heading and the single word "none". Do not list anything the agent can do in the code.`;
}

// What the building AI is told to do in its final message.
export function buildStepsRule(): string {
  return [
    "- Does the owner have to do anything themselves for this change to work once it is merged? For example set a new environment variable, create an account or API key, change a setting on the host or in a dashboard, add a DNS record, or run a one-off script or database change by hand.",
    "  Put the answer at the VERY START of your final message, before the summary: a line `OWNER STEPS`, then one line per step beginning with `BEFORE MERGE:` (must be done before the merge so the deploy works) or `AFTER MERGE:` (can only be done once it is live), then plain words for someone who is not technical, naming exact variable names but NEVER a secret value. If there is nothing, write `OWNER STEPS: none`.",
    "  When the code reads a new environment variable, add it to the project's `.env.example` (if the repo has one) with an empty value, and make the code say clearly what is missing instead of crashing with an obscure error.",
  ].join("\n");
}

// ---- Finding new environment variables in a change ----

// Variables the platform or the tools set themselves; nobody has to add these.
const BUILT_IN = new Set([
  "NODE_ENV", "CI", "PORT", "HOME", "PATH", "PWD", "TZ", "LANG", "USER", "SHELL", "TERM", "DEBUG", "VERCEL", "VERCEL_ENV", "VERCEL_URL",
  "VERCEL_REGION", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF", "VERCEL_PROJECT_PRODUCTION_URL", "NEXT_RUNTIME", "NEXT_PHASE",
  "NETLIFY", "CONTEXT", "URL", "DEPLOY_URL", "GITHUB_ACTIONS", "GITHUB_SHA", "GITHUB_REF", "GITHUB_REPOSITORY", "GITHUB_TOKEN", "RUNNER_OS",
  "npm_package_version", "NEXT_TELEMETRY_DISABLED", "ANALYZE", "FORCE_COLOR", "NO_COLOR", "LOG_LEVEL",
]);

const USES: RegExp[] = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /Deno\.env\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /os\.environ(?:\.get)?\s*[\[(]\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /os\.getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /\bENV(?:\.fetch)?\s*[\[(]\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /\bgetenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
];

const NOT_CODE = /(^|\/)(tests?|__tests__|e2e|spec|docs?|\.github)\/|\.(test|spec)\.[a-z]+$|\.(md|mdx|txt|lock|svg|png|jpg|json)$|(^|\/)(package-lock\.json|\.env[^/]*|[^/]*\.env)$/i;

export const ENV_EXAMPLE_FILES = [".env.example", ".env.sample", ".env.template", "example.env", ".env.local.example", ".env.development.example"];

export function envNamesIn(text: string): string[] {
  const found = new Set<string>();
  for (const re of USES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = m[1];
      if (/^[A-Z][A-Z0-9_]*$/.test(n) && !BUILT_IN.has(n)) found.add(n);
    }
  }
  return [...found];
}

// Names written in a .env.example-style file: "NAME=value", "# NAME=value" and "export NAME=...".
export function namesInEnvExample(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(?:#\s*)?(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

export type ChangedFile = { name: string; patch?: string | null };

// The environment variables a change reads for the first time. A name counts when an ADDED line in a source file uses it
// and neither the project's .env.example nor the surrounding (unchanged or removed) code in the change already uses it,
// which would mean the project had it before. It is a good guess, not a proof, so the step it makes is worded as a check.
export function newEnvNames(files: ChangedFile[], documented: Iterable<string>): string[] {
  const known = new Set(documented);
  const added = new Set<string>();
  for (const f of files) {
    if (!f.patch || NOT_CODE.test(f.name)) continue;
    for (const line of f.patch.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
      if (line.startsWith("+")) envNamesIn(line.slice(1)).forEach((n) => added.add(n));
      else envNamesIn(line.slice(1)).forEach((n) => known.add(n));
    }
  }
  return [...added].filter((n) => !known.has(n)).sort().slice(0, 8);
}

export function envStepsFromChanges(files: ChangedFile[], documented: Iterable<string>): OwnerStep[] {
  return newEnvNames(files, documented)
    .map((n) => makeStep("code", "before", `Check that the setting ${n} exists where your site runs. This change reads it and it is not in your .env.example, so it looks new. If you have not added it yet, add it (the "How do I do this?" help below shows where). If it is already set, tick "Not needed".`))
    .filter((s): s is OwnerStep => !!s);
}

// ---- Keeping the list ----

// What is stored on the idea is trusted only after it is checked: it is JSON the database hands back.
export function readSteps(value: unknown): OwnerStep[] {
  if (!Array.isArray(value)) return [];
  const out: OwnerStep[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.text !== "string") continue;
    const source = o.source === "plan" || o.source === "ai" || o.source === "code" ? o.source : "ai";
    out.push({
      id: o.id.slice(0, 40),
      text: cleanText(o.text, STEP_TEXT_MAX),
      when: o.when === "after" ? "after" : "before",
      source,
      done: o.done === true,
      ...(o.skipped === true ? { skipped: true } : {}),
      ...(typeof o.doneAt === "string" ? { doneAt: o.doneAt } : {}),
    });
    if (out.length >= STEPS_MAX) break;
  }
  return out;
}

// Puts new steps from `sources` into the list in place of the old ones from those sources. A step that was already
// there keeps its tick. A "code" step whose variable name is already named in another step is dropped as a repeat.
export function mergeSteps(existing: OwnerStep[], incoming: OwnerStep[], sources: StepSource[]): OwnerStep[] {
  const before = new Map(existing.map((s) => [s.id, s]));
  const kept = existing.filter((s) => !sources.includes(s.source));
  const fresh = incoming
    .filter((s) => sources.includes(s.source))
    .map((s) => {
      const old = before.get(s.id);
      return old ? { ...s, done: old.done, ...(old.skipped ? { skipped: true } : {}), ...(old.doneAt ? { doneAt: old.doneAt } : {}) } : s;
    });
  const all = [...kept, ...fresh];
  const named = (s: OwnerStep) => all.some((o) => o !== s && o.source !== "code" && namesOf(s).some((n) => new RegExp(`\\b${n}\\b`).test(o.text)));
  return all.filter((s, i) => all.findIndex((o) => o.id === s.id) === i && !(s.source === "code" && named(s))).slice(0, STEPS_MAX);
}

const namesOf = (s: OwnerStep) => (/setting ([A-Z][A-Z0-9_]*)/.exec(s.text) ?? []).slice(1);

export const stepsLeft = (steps: OwnerStep[]) => steps.filter((s) => !s.done);
export const stepsLeftBefore = (steps: OwnerStep[]) => steps.filter((s) => !s.done && s.when === "before");

export function setStepState(steps: OwnerStep[], id: string, state: "done" | "skipped" | "open", now = new Date()): OwnerStep[] | null {
  if (!steps.some((s) => s.id === id)) return null;
  return steps.map((s) => {
    if (s.id !== id) return s;
    const { skipped: _s, doneAt: _d, ...rest } = s;
    void _s; void _d;
    return state === "open" ? { ...rest, done: false } : { ...rest, done: true, ...(state === "skipped" ? { skipped: true } : {}), doneAt: now.toISOString() };
  });
}

// "3 setup steps", "1 setup step"
export const stepsWord = (n: number) => `${n} setup step${n === 1 ? "" : "s"}`;

// Plain-words help shown under a step. Environment variables are the common case and the one beginners get stuck on.
export type StepHelp = { title: string; steps: string[] };
export function helpFor(text: string): StepHelp {
  if (/env(ironment)?\s*(var|variable|setting)|\.env\b|api[ _-]?key|secret|token|setting [A-Z][A-Z0-9_]{2,}/i.test(text)) {
    return {
      title: "How to add an environment variable (a private setting your site reads)",
      steps: [
        "Find the name in the step above. It is written in capital letters with underscores, for example RESEND_API_KEY. Copy it exactly.",
        "Get the value. If the step says it comes from another service (an API key, a token), sign in to that service and copy the key from its settings page. Never paste a key into Idea HQ, an email or a chat.",
        "Open the place where your site runs. On Vercel: open vercel.com, pick your project, then Settings, then Environment Variables. On Netlify: Site configuration, then Environment variables. On another host, look for \"Environment variables\" or \"Config vars\" in the project settings.",
        "Add a new variable. Paste the name in the Name box and the value in the Value box. Keep Production ticked (and Preview if you want it on preview builds too), then Save.",
        "Redeploy. A new variable is only picked up by a new deploy. On Vercel: Deployments, the three dots on the latest one, Redeploy. Merging this change also deploys.",
        "Working on your own computer too? Open the file named .env.local in the project folder (make it if it is not there), add a line NAME=value, and restart the app.",
        "Come back here and tick the step. If the variable was already set, press Not needed instead.",
      ],
    };
  }
  return {
    title: "How to do this step",
    steps: [
      "Read the step above and do exactly what it says, in the place it names.",
      "If it names a website or dashboard, sign in there with your own account.",
      "Not sure what a word means or where to click? Ask whoever set up the project, or ask the AI in the build prompt box: What's wrong with this? takes plain words.",
      "When it is done, come back and tick the step. If it does not apply to you, press Not needed.",
    ],
  };
}
