import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

// The gray and emerald scales are read from CSS variables (see src/app/globals.css), so the same class names can
// show the notebook look in the light theme and the original colours in the dark theme.
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const scale = (name: string) => Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));

const config: Config = {
  // Dark styles apply when the page is set to the dark theme (the switcher in the menu), not by the device setting alone.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        gray: scale("gray"),
        emerald: scale("emerald"),
      },
    },
  },
  plugins: [
    // light:... styles apply in the light theme only.
    plugin(({ addVariant }) => addVariant("light", ':root:not([data-theme="dark"]) &')),
  ],
};
export default config;
