"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-600 mb-4">
            <Rocket className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {isRegister ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {isRegister
              ? "Set up your Idea HQ"
              : "Sign in to Idea HQ"}
          </p>
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            Idea HQ keeps the ideas for all your projects in one place, and an AI can build them for you as changes you approve.{" "}
            <Link href="/guide" className="text-emerald-600 hover:underline">What is this?</Link>
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {isRegister && (
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1.5"
                />
              </div>
            )}

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Min. 8 characters"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
                className="mt-1.5"
              />
            </div>

            {isRegister && siteKey && <div ref={widgetBox} aria-label="Security check" className="min-h-[65px]" />}

            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "Please wait..."
                : isRegister
                ? "Create account"
                : "Sign in"}
            </Button>
          </form>

          {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white dark:bg-gray-800 px-2 text-gray-500">
                    Or continue with
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => signIn("google", { callbackUrl: "/ideas" })}
              >
                Continue with Google
              </Button>
            </>
          )}

          <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
            {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
              }}
              className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
            >
              {isRegister ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
