"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AUTH_BUTTON, AuthShell } from "@/components/landing/auth-shell";

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
    <AuthShell title="Confirm your email" highlight="email">
      {state === "missing" && <p className="m-0 text-[#3B3E45]">This link is incomplete. Open the link from the email again.</p>}
      {(state === "ready" || state === "working" || state === "failed") && (
        <>
          <p className="m-0 text-[#3B3E45]">Press the button to confirm that this email address is yours.</p>
          <button type="button" className={`${AUTH_BUTTON} mt-5`} onClick={confirm} disabled={state === "working"}>
            {state === "working" ? "Confirming…" : "Confirm my email"}
          </button>
          {state === "failed" && <p role="alert" className="mb-0 mt-3 text-[15px] font-medium text-[#B42318]">{error}</p>}
        </>
      )}
      {state === "done" && (
        <>
          <p role="status" className="m-0 text-[#3B3E45]">Thank you, your email is confirmed. The owner can approve your account now.</p>
          <Link href="/ideas" className={`${AUTH_BUTTON} mt-5 no-underline`}>Continue to Idea HQ</Link>
        </>
      )}
    </AuthShell>
  );
}
