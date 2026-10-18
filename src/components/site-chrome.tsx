import Link from "next/link";
import { Rocket } from "lucide-react";

// Header and footer shared by the public pages (landing page, guide).
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
            <Rocket className="w-5 h-5 text-white" />
          </span>
          <span className="font-bold text-gray-900 dark:text-white">Idea HQ</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/guide" className="text-gray-600 dark:text-gray-300 hover:text-emerald-600">Guide</Link>
          {signedIn ? (
            <Link href="/ideas" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Open the app</Link>
          ) : (
            <>
              <Link href="/auth/signin" className="text-gray-600 dark:text-gray-300 hover:text-emerald-600">Sign in</Link>
              <Link href="/auth/signin?mode=register" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800 mt-16">
      <div className="max-w-3xl mx-auto px-4 py-6 text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1 justify-between">
        <span>Idea HQ</span>
        <span className="flex gap-4">
          <Link href="/guide" className="hover:text-emerald-600">Guide</Link>
          <Link href="/guide#stuck" className="hover:text-emerald-600">Stuck?</Link>
        </span>
      </div>
    </footer>
  );
}
