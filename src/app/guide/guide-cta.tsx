"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

// The closing box of the Guide: a way back into the app when signed in, an invitation to sign up when not. It asks the
// browser's session, so the Guide itself is the same static page for everyone (see the note in page.tsx).
export function GuideCta() {
  const { status } = useSession();
  if (status === "loading") return <div aria-hidden="true" className="h-[5.5rem]" />;
  return status === "authenticated" ? (
    <Link href="/ideas" className="px-5 py-2.5 rounded-lg bg-emerald-700 text-white font-medium hover:bg-emerald-800 inline-block">Back to my ideas</Link>
  ) : (
    <>
      <p className="font-semibold">Ready to try it?</p>
      <Link href="/auth/signin?mode=register" className="mt-3 px-5 py-2.5 rounded-lg bg-emerald-700 text-white font-medium hover:bg-emerald-800 inline-block">Create an account</Link>
    </>
  );
}
