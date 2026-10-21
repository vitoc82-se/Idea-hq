import { requireRepoAccess } from "@/lib/github/access";
import { db } from "@/lib/db";
import { github as realGithub, type GitHubApi } from "@/lib/github/client";
import { KNOWLEDGE_FILE, renderMarkdown, withClaudeImport } from "./knowledge";
import { loadKnowledge } from "./knowledge-store";
import { RunError } from "./runs/engine";

// Saves Idea HQ's knowledge into the repo as .idea-hq/KNOWLEDGE.md (plus an
// @import line in CLAUDE.md, which Claude Code reads automatically). Idea HQ keeps
// its own copy either way. Done through a pull request the owner merges.
export async function exportKnowledgeToRepo(userId: string, projectId: string, gh: GitHubApi = realGithub): Promise<{ number: number; reused: boolean }> {
  const loaded = await loadKnowledge(userId, projectId);
  if (!loaded) throw new RunError(404, "Project not found");
  const { project: p, knowledge } = loaded;
  if (!p.installationId || !p.repoOwner || !p.repoName) throw new RunError(409, "Connect a GitHub repo to this project first.");
  await requireRepoAccess(p);
  if (!Object.keys(knowledge.sections).length) throw new RunError(409, "There is nothing to save yet. Draft or write the knowledge first.");
  const i = p.installationId, o = p.repoOwner, r = p.repoName;

  if (p.knowledgePrNumber) {
    const open = await gh.getPr(i, o, r, p.knowledgePrNumber).catch(() => null);
    if (open && open.state === "open") return { number: open.number, reused: true };
  }
  const map = (p.envBranches || {}) as Record<string, string>;
  const base = map[p.defaultEnv || ""] || Object.values(map)[0];
  if (!base) throw new RunError(409, "Set an environment and base branch for this project.");
  const b = await gh.repoBranch(i, o, r, base);
  if (!b) throw new RunError(409, `Base branch "${base}" was not found.`);

  const branch = `idea-hq/knowledge-${Date.now().toString(36)}`;
  await gh.createBranch(i, o, r, branch, b.sha);
  const existing = await gh.getFile(i, o, r, KNOWLEDGE_FILE, base);
  await gh.putFile(i, o, r, KNOWLEDGE_FILE, branch, renderMarkdown(knowledge, p.name), "Update project knowledge (Idea HQ)", existing?.sha);
  const claude = await gh.getFile(i, o, r, "CLAUDE.md", base);
  const withImport = withClaudeImport(claude?.content);
  if (!claude || withImport !== claude.content.trimEnd() + "\n") {
    await gh.putFile(i, o, r, "CLAUDE.md", branch, withImport, "Point CLAUDE.md at the project knowledge", claude?.sha);
  }
  const pr = await gh.openPr(i, o, r, {
    head: branch,
    base,
    title: "Save project knowledge for AI tools",
    body: "Idea HQ's description of this project, saved in the repo so any AI tool working here starts with the same understanding.\n\nIt is plain text you can read and edit. Merge it to keep a copy in the repo.",
  });
  await db.project.update({ where: { id: p.id }, data: { knowledgePrNumber: pr.number } });
  return { number: pr.number, reused: false };
}
