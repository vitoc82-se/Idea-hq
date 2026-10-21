"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AUTH_BUTTON, AUTH_BUTTON_QUIET, AUTH_INPUT, AUTH_LINK, AuthLabel, AuthShell } from "@/components/landing/auth-shell";

type Turnstile = {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

export default function SignInPage() {
  const router = useRouter();
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);

  // "Create account" links arrive with ?mode=register.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "register") setIsRegister(true);
  }, []);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("changed") === "1") setChanged(true);
  }, []);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  // Creating an account asks Cloudflare "are you a person?" (the same check the support form uses).
  const [siteKey, setSiteKey] = useState("");
  const [captcha, setCaptcha] = useState("");
  const widgetBox = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isRegister) return;
    let live = true;
    fetch("/api/auth/turnstile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && j && setSiteKey(typeof j.siteKey === "string" ? j.siteKey : ""))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [isRegister]);

  useEffect(() => {
    if (!isRegister || !siteKey) return;
    let cancelled = false;
    const draw = () => {
      if (cancelled || !widgetBox.current || !window.turnstile || widgetId.current !== undefined) return;
      widgetId.current = window.turnstile.render(widgetBox.current, {
        sitekey: siteKey,
        callback: (t) => setCaptcha(t),
        "expired-callback": () => setCaptcha(""),
        "error-callback": () => setCaptcha(""),
      });
    };
    if (window.turnstile) draw();
    else {
      let s = document.getElementById("turnstile-script") as HTMLScriptElement | null;
      if (!s) {
        s = document.createElement("script");
        s.id = "turnstile-script";
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener("load", draw);
    }
    return () => {
      cancelled = true;
      if (widgetId.current !== undefined) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
      setCaptcha("");
    };
  }, [isRegister, siteKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isRegister) {
        if (siteKey && !captcha) {
          setError("Please complete the check below first.");
          setLoading(false);
          return;
        }
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, token: captcha }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Could not create the account. Try again in a moment.");
          // A check can only be used once.
          if (widgetId.current !== undefined) window.turnstile?.reset(widgetId.current);
          setCaptcha("");
          setLoading(false);
          return;
        }
      }

      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error === "TOO_MANY_ATTEMPTS" ? "Too many attempts. Wait a few minutes and try again." : "Invalid email or password");
        setLoading(false);
        return;
      }

      router.push("/ideas");
    } catch {
      setError("Could not reach Idea HQ. Check your connection and try again.");
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={isRegister ? "Create your account" : "Welcome back"}
      highlight={isRegister ? "account" : "back"}
      note={isRegister ? "Set up your Idea HQ" : "Sign in to Idea HQ"}
      intro={
        <>
          Idea HQ keeps the ideas for all your projects in one place, and an AI can build them for you as changes you approve.{" "}
          <Link href="/guide" className={AUTH_LINK}>What is this?</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {isRegister && (
          <div>
            <AuthLabel htmlFor="name">Name</AuthLabel>
            <input
              id="name"
              type="text"
              placeholder="Your name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={AUTH_INPUT}
            />
          </div>
        )}

        <div>
          <AuthLabel htmlFor="email">Email</AuthLabel>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            className={AUTH_INPUT}
          />
        </div>

        <div>
          <AuthLabel htmlFor="password">Password</AuthLabel>
          <input
            id="password"
            type="password"
            placeholder="Min. 8 characters"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
            className={AUTH_INPUT}
          />
        </div>

        {isRegister && siteKey && <div ref={widgetBox} aria-label="Security check" className="min-h-[65px]" />}

        {changed && !isRegister && !error && (
          <p role="status" className="m-0 text-[15px] font-medium text-[#1A7F37]">Your password was changed. Sign in with the new one.</p>
        )}
        {error && (
          <p role="alert" className="m-0 text-[15px] font-medium text-[#B42318]">{error}</p>
        )}

        <button type="submit" className={AUTH_BUTTON} disabled={loading}>
          {loading ? "Please wait..." : isRegister ? "Create account" : "Sign in"}
        </button>
      </form>

      {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
        <>
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-dashed border-[#9A9DA5]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-[#55585F]">Or continue with</span>
            </div>
          </div>

          <button type="button" className={AUTH_BUTTON_QUIET} onClick={() => signIn("google", { callbackUrl: "/ideas" })}>
            Continue with Google
          </button>
        </>
      )}

      <p className="m-0 mt-6 text-center text-[15px] text-[#3B3E45]">
        {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setIsRegister(!isRegister);
            setError("");
          }}
          className={AUTH_LINK}
        >
          {isRegister ? "Sign in" : "Create one"}
        </button>
      </p>
    </AuthShell>
  );
}
