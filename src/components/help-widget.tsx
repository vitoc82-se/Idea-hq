"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

// Idea HQ's own Help button. It stays off the public pages that belong to someone else's
// product (a project's "What's new" page), where it would look like their support button.
export function HelpWidget() {
  const path = usePathname();
  if (path?.startsWith("/changes/")) return null;
  return <Script src="https://ideahq.cloud/embed/ihq_-_xUVVCWx3RoG-QU.js" strategy="lazyOnload" />;
}
