import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PWARegister } from "@/components/pwa-register";
import { HelpWidget } from "@/components/help-widget";
import { notebookSans, notebookPen } from "@/components/landing/fonts";
import { THEME_SCRIPT } from "@/lib/theme";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const SITE_TITLE = "Idea HQ: write down ideas, review the finished changes";
const SITE_DESCRIPTION =
  "Write your ideas down. Idea HQ plans each one, an AI builds it inside your own GitHub project, and you approve the result before anything changes.";

export const metadata: Metadata = {
  metadataBase: new URL("https://ideahq.cloud"),
  title: { default: SITE_TITLE, template: "%s · Idea HQ" },
  description: SITE_DESCRIPTION,
  applicationName: "Idea HQ",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Idea HQ" },
  openGraph: {
    type: "website",
    siteName: "Idea HQ",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

// Pinch-zoom stays on: people who need larger text rely on it.
export const viewport: Viewport = {
  themeColor: [
    { color: "#fafaf7", media: "(prefers-color-scheme: light)" },
    { color: "#0f172a", media: "(prefers-color-scheme: dark)" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the theme script below sets data-theme on <html> before React starts.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${notebookSans.variable} ${notebookPen.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <PWARegister />
        <HelpWidget />
      </body>
    </html>
  );
}
