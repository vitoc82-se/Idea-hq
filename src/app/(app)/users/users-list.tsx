"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type U = { id: string; name: string | null; email: string | null; approved: boolean };

export function UsersList() {
  const [users, setUsers] = useState<U[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/admin/users");
    if (!res.ok) return setError("Could not load users");
    setUsers((await res.json()).users);
  };
  useEffect(() => {
    load();
  }, []);

  const setApproved = async (id: string, approved: boolean) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    if (!res.ok) return setError("Update failed");
    setError("");
    load();
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Users</h1>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <ul className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">{u.name || u.email}</p>
              <p className="text-xs text-gray-500">{u.email}</p>
            </div>
            <Button
              variant={u.approved ? "outline" : "default"}
              onClick={() => setApproved(u.id, !u.approved)}
            >
              {u.approved ? "Revoke" : "Approve"}
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-500 mt-3">
        The owner is always allowed. New accounts see nothing until approved.
      </p>
    </div>
  );
}
