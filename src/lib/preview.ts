import type { PrComment } from "./github/client";

// Finds the "see it running" link for a change. Hosts that build every pull request
// (Vercel, Netlify, Cloudflare Pages, ...) post a comment on it with the preview address.
// Only comments written by a GitHub App (bot) count, and only addresses on known preview
// hosts, because anyone with access to the repo can write a normal comment.

const HOSTS = ["vercel.app", "netlify.app", "pages.dev", "onrender.com", "fly.dev", "web.app", "firebaseapp.com", "surge.sh", "github.io"];
const URL_RE = /https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9](?:\/[^\s)<>\]"']*)?/gi;

function allowed(host: string): boolean {
  return HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export function previewUrlFrom(comments: PrComment[]): string | null {
  for (const c of [...comments].reverse()) {
    if (!c.bot) continue;
    // Prefer an address on a line that talks about a preview, then any allowed address.
    const lines = c.body.split("\n");
    const ordered = [...lines.filter((l) => /preview/i.test(l)), ...lines.filter((l) => !/preview/i.test(l))];
    for (const line of ordered) {
      for (const m of Array.from(line.matchAll(URL_RE))) {
        try {
          const u = new URL(m[0].replace(/[.,;:!?]+$/, ""));
          if (u.protocol === "https:" && !u.username && !u.password && allowed(u.hostname) && u.href.length <= 300) return u.origin;
        } catch {
          /* not a usable address */
        }
      }
    }
  }
  return null;
}

// Re-check at most this often while no preview has been found yet (hosts take a minute or two).
export const PREVIEW_RECHECK_MS = 45 * 1000;
