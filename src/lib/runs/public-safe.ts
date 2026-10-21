// A public repository shows everything the workflow touches to the whole internet: the run's inputs and logs in
// Actions, and the pull request text. So text that goes there is stripped of personal details first
// (customer emails and phone numbers that came in through support tickets), and the owner is told.

// Treated as public unless GitHub said it is private (old projects have no answer until their setup page is opened).
export const repoMayBePublic = (p: { repoPrivate?: boolean | null }) => p.repoPrivate !== true;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// 8 or more digits, with the usual separators (a phone number, not a version number or a date).
const PHONE = /(?<![\w.])(?:\+|\()?\d(?:[\s().-]{0,2}\d){7,}(?!\w)/g;

export function redactPersonalDetails(text: string): string {
  return text.replace(EMAIL, "[email removed]").replace(PHONE, (m) => (/^\d{4}-\d{2}-\d{2}/.test(m) ? m : "[number removed]"));
}

export const PUBLIC_REPO_NOTICE =
  "This repository is public. What the AI is told (the idea, its plan and any customer text) and what it answers show up in the repository's Actions logs and pull requests, where anyone can read them. Email addresses and phone numbers are removed automatically; leave out names and anything private.";
