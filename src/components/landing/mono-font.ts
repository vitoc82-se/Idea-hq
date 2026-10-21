import { IBM_Plex_Mono } from "next/font/google";

// Receipts on the start page. Kept apart from fonts.ts so the signed-in app does not download it.
export const notebookMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--nb-mono", display: "swap" });
