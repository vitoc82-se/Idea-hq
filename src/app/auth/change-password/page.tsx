"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { AUTH_BUTTON, AUTH_INPUT, AuthLabel, AuthShell } from "@/components/landing/auth-shell";

export default function ChangePasswordPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.next !== form.confirm) {
      setError("New passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.current,
          newPassword: form.next,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not change password");
        setLoading(false);
        return;
      }
      // Every session is signed out by a password change, this one too: sign in again with the new password.
      await signOut({ callbackUrl: "/auth/signin?changed=1" });
    } catch {
      setError("Could not change the password. Check your connection and try again.");
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Change password" highlight="password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <AuthLabel htmlFor="current">Current password</AuthLabel>
          <input
            id="current"
            type="password"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
            required
            className={AUTH_INPUT}
          />
        </div>
        <div>
          <AuthLabel htmlFor="next">New password</AuthLabel>
          <input
            id="next"
            type="password"
            placeholder="Min. 8 characters"
            value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
            required
            minLength={8}
            className={AUTH_INPUT}
          />
        </div>
        <div>
          <AuthLabel htmlFor="confirm">Confirm new password</AuthLabel>
          <input
            id="confirm"
            type="password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            required
            minLength={8}
            className={AUTH_INPUT}
          />
        </div>

        {error && <p role="alert" className="m-0 text-[15px] font-medium text-[#B42318]">{error}</p>}

        <button type="submit" className={AUTH_BUTTON} disabled={loading}>
          {loading ? "Please wait..." : "Change password"}
        </button>
      </form>
    </AuthShell>
  );
}
