import { db } from "./db";
import { baseUrl, sendEmail } from "./support/email";
import { headerSafe } from "./support/sanitize";

// Email to the person who owns a run when something needs them: a change is ready
// for review, a revision finished, or a run failed. Never throws and never blocks a
// run: a failed send is just a missed email. Only what the person wrote themselves
// (their idea title, project name) goes into the email, plus the run's own error line.

export type RunEvent = "ready" | "updated" | "failed";

type Deps = { fetchImpl?: typeof fetch };

function what(kind: string, title: string): string {
  if (kind === "learn") return "the project knowledge";
  if (kind === "revert") return `the undo of "${title}"`;
  return `"${title}"`;
}

export function runEmail(p: { event: RunEvent; kind: string; title: string; project: string; error: string | null; link: string; settingsLink: string }) {
  const subject =
    p.event === "failed"
      ? `Did not finish: ${headerSafe(p.title, 80)} (${headerSafe(p.project, 40)})`
      : p.event === "updated"
      ? `Updated and ready again: ${headerSafe(p.title, 80)} (${headerSafe(p.project, 40)})`
      : `Ready for review: ${headerSafe(p.title, 80)} (${headerSafe(p.project, 40)})`;
  const lines =
    p.event === "failed"
      ? [`The AI could not finish ${what(p.kind, p.title)} in ${p.project}.`, p.error ? `\n${p.error.slice(0, 300)}` : "", "\nNothing was changed in your project. Open it to try again or adjust the idea:"]
      : p.event === "updated"
      ? [`The AI changed ${what(p.kind, p.title)} in ${p.project} as you asked, and it is ready for another look:`]
      : [`The AI finished ${what(p.kind, p.title)} in ${p.project}. Read the change, ask for tweaks, or merge it:`];
  return {
    subject,
    text: [...lines, p.link, "", `You get this email because you use Idea HQ. You can turn it off here: ${p.settingsLink}`].filter((l) => l !== undefined).join("\n"),
  };
}

export async function notifyRunEvent(runId: string, event: RunEvent, deps: Deps = {}): Promise<boolean> {
  try {
    const run = await db.run.findUnique({
      where: { id: runId },
      include: { user: { select: { email: true, notifyEmail: true } }, project: { select: { id: true, name: true } }, idea: { select: { id: true, title: true } } },
    });
    if (!run?.user?.email || run.user.notifyEmail === false) return false;
    const path = run.kind === "learn" ? `/projects/${run.project.id}/knowledge` : run.idea ? `/ideas/${run.idea.id}` : "/ideas";
    const mail = runEmail({
      event,
      kind: run.kind,
      title: run.idea?.title || (run.kind === "learn" ? "Project knowledge" : "a change"),
      project: run.project.name,
      error: event === "failed" ? run.error : null,
      link: `${baseUrl()}${path}`,
      settingsLink: `${baseUrl()}/settings`,
    });
    return await sendEmail({ to: run.user.email, subject: mail.subject, text: mail.text, fromName: "Idea HQ", timeoutMs: 4000 }, deps.fetchImpl);
  } catch {
    return false;
  }
}
