import { Familjen_Grotesk, Shantell_Sans, IBM_Plex_Mono } from "next/font/google";

// The three faces of the landing page ("the notebook"). Next downloads them at build time and serves them from our
// own domain, so the page makes no request to Google and the security policy (font-src 'self') stays as it is.
// They are only used inside the landing wrapper, so the signed-in app does not load them.
export const notebookSans = Familjen_Grotesk({ subsets: ["latin"], variable: "--nb-sans", display: "swap" });
export const notebookPen = Shantell_Sans({ subsets: ["latin"], variable: "--nb-pen", display: "swap" });
export const notebookMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--nb-mono", display: "swap" });
