import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AccountLinks } from "@/components/account-links";

// Header and footer shared by the public pages (landing page, guide). `signedIn` is for a page that knows who is looking;
// left out, the browser's own session decides (the Guide, which is one static page for everyone).
export function SiteHeader({ signedIn, wide = false }: { signedIn?: boolean; wide?: boolean }) {
  return (
    <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-20">
      <div className={`${wide ? "max-w-6xl" : "max-w-3xl"} mx-auto px-4 h-14 flex items-center justify-between`}>
        <Link href="/" className="flex items-center gap-2">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <ThemeSwitcher compact className="hidden min-[560px]:flex" />
          <Link href="/guide" className="hidden min-[420px]:inline py-3 text-gray-700 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-400">Guide</Link>
          <AccountLinks signedIn={signedIn} />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ wide = false }: { wide?: boolean }) {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800 mt-16">
      <div className={`${wide ? "max-w-6xl" : "max-w-3xl"} mx-auto px-4 py-6 text-sm text-gray-600 dark:text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1 justify-between`}>
        <span>Idea HQ</span>
        <span className="flex gap-4">
          <Link href="/guide" className="py-3 hover:text-emerald-700 dark:hover:text-emerald-400">Guide</Link>
          <Link href="/guide#stuck" className="py-3 hover:text-emerald-700 dark:hover:text-emerald-400">Stuck?</Link>
        </span>
      </div>
    </footer>
  );
}
