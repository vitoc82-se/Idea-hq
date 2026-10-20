import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PWARegister } from "@/components/pwa-register";

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
  themeColor: "#047857",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <PWARegister />
        <Script src="https://ideahq.cloud/embed/ihq_-_xUVVCWx3RoG-QU.js" strategy="lazyOnload" />
      </body>
    </html>
  );
}
