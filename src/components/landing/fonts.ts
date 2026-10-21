import { Familjen_Grotesk, Shantell_Sans } from "next/font/google";

// The notebook typefaces: Familjen Grotesk for text, Shantell Sans for handwritten notes. They are used by the start
// page, the sign-in screens and the light theme of the app, so the root layout loads them for every page. Next
// downloads them at build time and serves them from our own domain (font-src 'self' still holds).
// The monospace face for receipts lives in mono-font.ts because only the start page uses it.
export const notebookSans = Familjen_Grotesk({ subsets: ["latin"], variable: "--nb-sans", display: "swap" });
export const notebookPen = Shantell_Sans({ subsets: ["latin"], variable: "--nb-pen", display: "swap" });
