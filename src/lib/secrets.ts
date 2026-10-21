// One master secret (NEXTAUTH_SECRET) used to sign everything meant that changing it, for example after a suspected
// leak, signed everyone out AND broke every customer's ticket link at once. Each purpose can now have a secret of its
// own. Nothing changes until one is set: without it a purpose uses NEXTAUTH_SECRET exactly as before, so existing
// links, tokens and sessions keep working.
//
// To make a purpose independent, set its variable to the CURRENT value of NEXTAUTH_SECRET once (so nothing breaks),
// and from then on NEXTAUTH_SECRET can be rotated without touching it.
export type Purpose = "ticket" | "ident" | "blob" | "email" | "state";

export const SECRET_ENV: Record<Purpose, string> = {
  ticket: "TICKET_TOKEN_SECRET", // the private link in a customer's ticket emails (rotating it breaks those links)
  ident: "RATE_LIMIT_SECRET", // hashes of IP addresses and emails in the rate-limit table (rotating it only resets the counters)
  blob: "SIGNED_BLOB_SECRET", // the one-hour answer handed from the help widget to the ticket form
  email: "EMAIL_LINK_SECRET", // "confirm your email" links
  state: "OAUTH_STATE_SECRET", // the GitHub connect round trip
};

const MIN_LENGTH = 32;

export function secretFor(purpose: Purpose): string {
  const own = process.env[SECRET_ENV[purpose]];
  if (own !== undefined && own !== "") {
    // A secret that is set must be a real one: never fall back to something weaker silently.
    if (own.length < MIN_LENGTH) throw new Error(`${SECRET_ENV[purpose]} must be at least ${MIN_LENGTH} characters`);
    return own;
  }
  const master = process.env.NEXTAUTH_SECRET;
  if (!master) throw new Error("NEXTAUTH_SECRET is not set");
  return master;
}
