"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

// Idea HQ's own Help button. It stays off the public pages that belong to someone else's
// product (a project's "What's new" page), where it would look like their support button.
const DEFAULT_HELP_KEY = "ihq_-_xUVVCWx3RoG-QU";

export function HelpWidget() {
  const path = usePathname();
  if (path?.startsWith("/changes/")) return null;
  // This site's own Help space. Another installation sets NEXT_PUBLIC_HELP_WIDGET_KEY to its own key, or to an
  // empty value to show no Help button. The address is this site's own, so it works wherever the app is hosted.
  const key = process.env.NEXT_PUBLIC_HELP_WIDGET_KEY ?? DEFAULT_HELP_KEY;
  if (!key) return null;
  return <Script src={`/embed/${key}.js`} strategy="lazyOnload" />;
}
