"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY, type Theme } from "@/lib/theme";

const current = (): Theme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

// Light / Dark. The choice is kept in this browser (see lib/theme.ts).
export function ThemeSwitcher({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(current());
    // Another tab changed it.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const next: Theme = e.newValue === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      setTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const choose = (next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be blocked; the choice then lasts until the page is closed.
    }
    setTheme(next);
  };

  const option = (value: Theme, label: string, Icon: typeof Sun) => (
    <button
      type="button"
      aria-pressed={theme === value}
      aria-label={`${label} theme`}
      onClick={() => choose(value)}
      className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
        theme === value
          ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
          : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className={compact ? "hidden sm:inline" : undefined}>{label}</span>
    </button>
  );

  return (
    <div role="group" aria-label="Colour theme" className={`flex gap-1 rounded-lg border border-gray-300 p-0.5 dark:border-gray-600 ${className}`}>
      {option("light", "Light", Sun)}
      {option("dark", "Dark", Moon)}
    </div>
  );
}
