"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, X, Lightbulb, FolderKanban, LogOut, Rocket, KeyRound, Users, BookOpen, LifeBuoy } from "lucide-react";
import { Button } from "./ui/button";
import { APP_VERSION } from "@/lib/version";

const navLinks = [
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/users", label: "Users", icon: Users },
  { href: "/guide", label: "Guide", icon: BookOpen },
];

const supportLink = { href: "/support", label: "Support", icon: LifeBuoy };

export function Navbar() {
  const { data: session } = useSession();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  // The Support item only exists for accounts that have the tickets feature.
  const [support, setSupport] = useState<{ enabled: boolean; unread: number }>({ enabled: false, unread: 0 });
  const signedIn = !!session;

  useEffect(() => {
    if (!signedIn) return;
    let stop = false;
    const load = () =>
      fetch("/api/tickets/unread")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!stop && d) setSupport({ enabled: !!d.enabled, unread: Number(d.unread) || 0 });
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [signedIn]);

  if (!session) return null;
  const links = support.enabled ? [navLinks[0], navLinks[1], supportLink, ...navLinks.slice(2)] : navLinks;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 z-30">
        <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-200 dark:border-gray-700">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            Idea HQ
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-emerald-400 transition-colors"
            >
              <link.icon className="w-5 h-5" />
              {link.label}
              {link.href === "/support" && support.unread > 0 && (
                <span className="ml-auto rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white" aria-label={`${support.unread} unread`}>
                  {support.unread}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center text-sm font-medium text-emerald-700 dark:text-emerald-300">
              {session.user?.name?.[0]?.toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {session.user?.name || "User"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {session.user?.email}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-gray-600 dark:text-gray-400"
            onClick={() => router.push("/auth/change-password")}
          >
            <KeyRound className="w-5 h-5" />
            Change password
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-gray-600 dark:text-gray-400"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            <LogOut className="w-5 h-5" />
            Sign out
          </Button>
          <p
            className="px-3 pt-2 text-xs text-gray-500 dark:text-gray-400 truncate select-none"
            title={APP_VERSION}
          >
            {APP_VERSION}
          </p>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 inset-x-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 z-30">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Rocket className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900 dark:text-white">
              Idea HQ
            </span>
          </div>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 text-gray-600 dark:text-gray-400"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {mobileOpen && (
          <nav className="px-4 py-2 pb-4 space-y-1 border-t border-gray-100 dark:border-gray-800">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-emerald-400 transition-colors"
              >
                <link.icon className="w-5 h-5" />
                {link.label}
                {link.href === "/support" && support.unread > 0 && (
                  <span className="ml-auto rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white" aria-label={`${support.unread} unread`}>
                    {support.unread}
                  </span>
                )}
              </Link>
            ))}
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-gray-600 dark:text-gray-400"
              onClick={() => router.push("/auth/change-password")}
            >
              <KeyRound className="w-5 h-5" />
              Change password
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-gray-600 dark:text-gray-400"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              <LogOut className="w-5 h-5" />
              Sign out
            </Button>
          </nav>
        )}
      </header>
    </>
  );
}
