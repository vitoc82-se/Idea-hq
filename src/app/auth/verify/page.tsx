"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type State = "ready" | "working" | "done" | "failed" | "missing";

// The link in the confirmation email lands here. Confirming is a button press (a POST), so a mail
// scanner that merely opens the link cannot confirm the address.
export default function VerifyPage() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<State>("ready");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    setToken(t);
    if (!t) setState("missing");
  }, []);

  const confirm = async () => {
    setState("working");
    setError("");
    try {
      const res = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "That did not work. Try again in a moment.");
        setState("failed");
        return;
      }
      setState("done");
    } catch {
      setError("Could not reach Idea HQ. Check your connection and try again.");
      setState("failed");
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Confirm your email</h1>
        {state === "missing" && <p className="mt-3 text-gray-700 dark:text-gray-300">This link is incomplete. Open the link from the email again.</p>}
        {(state === "ready" || state === "working" || state === "failed") && (
          <>
            <p className="mt-3 text-gray-700 dark:text-gray-300">Press the button to confirm that this email address is yours.</p>
            <Button className="mt-5 w-full bg-emerald-700 hover:bg-emerald-800" onClick={confirm} disabled={state === "working"}>
              {state === "working" ? "Confirming…" : "Confirm my email"}
            </Button>
            {state === "failed" && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
          </>
        )}
        {state === "done" && (
          <>
            <p role="status" className="mt-3 text-gray-700 dark:text-gray-300">Thank you, your email is confirmed. The owner can approve your account now.</p>
            <Link href="/ideas" className="mt-5 inline-flex min-h-[44px] items-center rounded-lg bg-emerald-700 px-4 font-semibold text-white hover:bg-emerald-800">Continue to Idea HQ</Link>
          </>
        )}
      </div>
    </main>
  );
}
