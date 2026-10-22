"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

const LINK = "py-3 text-gray-700 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-400";
const BUTTON = "px-3 py-3 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800";

function Links({ signedIn }: { signedIn: boolean }) {
  return signedIn ? (
    <Link href="/ideas" className={BUTTON}>Open the app</Link>
  ) : (
    <>
      <Link href="/auth/signin" className={LINK}>Sign in</Link>
      <Link href="/auth/signin?mode=register" className={BUTTON}>Create account</Link>
    </>
  );
}

// Signed in or not, from the browser's own session, for pages that are the same file for everyone (the Guide). Until
// the session is known there is an empty space the size of the buttons, so nothing jumps and nobody is first shown the
// wrong ones.
function FromSession() {
  const { status } = useSession();
  if (status === "loading") return <span aria-hidden="true" className="inline-block h-12 w-44" />;
  return <Links signedIn={status === "authenticated"} />;
}

// `signedIn` given: the page already knows (the start page and the 404 page). Left out: ask the browser's session.
export function AccountLinks({ signedIn }: { signedIn?: boolean }) {
  return signedIn === undefined ? <FromSession /> : <Links signedIn={signedIn} />;
}
