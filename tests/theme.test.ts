import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Familjen_Grotesk: () => ({ variable: "nb-sans" }),
  Shantell_Sans: () => ({ variable: "nb-pen" }),
  IBM_Plex_Mono: () => ({ variable: "nb-mono" }),
}));

import config from "../tailwind.config";
import { THEME_KEY, THEME_SCRIPT } from "@/lib/theme";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AuthShell } from "@/components/landing/auth-shell";

const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

// The first block in globals.css that starts with `selector {`, as { --name: value }.
function vars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(Array.from(body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)).map((m) => [m[1], m[2].trim()]));
}
const light = vars(":root");
const dark = vars(':root[data-theme="dark"]');

const rgb = (v: string) => v.split(" ").map(Number);
function lum([r, g, b]: number[]) {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: number[], b: number[]) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

describe("theme set-up", () => {
  it("dark styles follow the page's data-theme, and a light: variant exists", () => {
    expect(config.darkMode).toEqual(["selector", '[data-theme="dark"]']);
    expect(config.plugins?.length).toBeGreaterThan(0);
  });

  it("gray and emerald are read from variables, every shade, with room for opacity classes", () => {
    const colors = (config.theme?.extend as { colors: Record<string, Record<string, string>> }).colors;
    for (const name of ["gray", "emerald"]) for (const s of SHADES) expect(colors[name][s]).toBe(`rgb(var(--${name}-${s}) / <alpha-value>)`);
  });

  it("both themes define every shade", () => {
    for (const name of ["gray", "emerald"]) {
      for (const s of SHADES) {
        expect(light[`--${name}-${s}`], `light ${name}-${s}`).toMatch(/^\d+ \d+ \d+$/);
        expect(dark[`--${name}-${s}`], `dark ${name}-${s}`).toMatch(/^\d+ \d+ \d+$/);
      }
    }
  });

  it("the dark theme keeps Tailwind's original palette", () => {
    expect(dark["--gray-900"]).toBe("17 24 39");
    expect(dark["--gray-50"]).toBe("249 250 251");
    expect(dark["--emerald-600"]).toBe("5 150 105");
    expect(dark["--emerald-700"]).toBe("4 120 87");
  });

  it("no longer depends on the device setting for its colours", () => {
    expect(css).not.toMatch(/@media \(prefers-color-scheme/);
  });

  it("the notebook skin stays inside .nb-skin and the light theme", () => {
    const skin = css.slice(css.indexOf(":root:not("));
    // Selector lists, split at top-level commas (not the ones inside :is(...)).
    const selectors = skin
      .split("}")
      .map((rule) => rule.split("{")[0].replace(/\/\*[^]*?\*\//g, "").trim())
      .filter(Boolean)
      .flatMap((list) => list.split(/,(?![^(]*\))/).map((x) => x.trim()));
    expect(selectors.length).toBeGreaterThan(8);
    for (const sel of selectors) expect(sel).toMatch(/^:root:not\(\[data-theme="dark"\]\) \.nb-skin/);
  });
});

describe("light theme contrast (text 4.5:1, from the real palette)", () => {
  const white = [255, 255, 255];
  const paper = hex("#fafaf7");
  const tint = rgb(light["--emerald-50"]);
  const yellow = rgb(light["--emerald-100"]);
  const g = (n: string) => rgb(light[`--gray-${n}`]);
  const e = (n: string) => rgb(light[`--emerald-${n}`]);

  it("body and secondary text on white, paper and light fills", () => {
    for (const fg of ["400", "500", "600", "700", "900"]) {
      for (const [name, bg] of [["white", white], ["paper", paper], ["gray-100", g("100")]] as const) {
        expect(ratio(g(fg), bg), `gray-${fg} on ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("links and accents (emerald 600 to 800) on white, paper and the tinted fills", () => {
    for (const fg of ["600", "700", "800", "900"]) {
      for (const [name, bg] of [["white", white], ["paper", paper], ["tint", tint], ["yellow", yellow]] as const) {
        expect(ratio(e(fg), bg), `emerald-${fg} on ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("white text on the ink buttons and their hover colour", () => {
    expect(ratio(white, hex("#15161a"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(white, hex("#2d2f34"))).toBeGreaterThanOrEqual(4.5);
  });

  it("field borders (gray-300) are visible against white and paper (3:1)", () => {
    expect(ratio(g("300"), white)).toBeGreaterThanOrEqual(3);
    expect(ratio(g("300"), paper)).toBeGreaterThanOrEqual(3);
  });
});

describe("theme script", () => {
  const run = (stored: string | null, prefersDark: boolean, broken = false) => {
    const attrs: Record<string, string> = {};
    const doc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
    const win = { matchMedia: () => ({ matches: prefersDark }) };
    const store = {
      getItem: (k: string) => {
        if (broken) throw new Error("blocked");
        expect(k).toBe(THEME_KEY);
        return stored;
      },
    };
    new Function("document", "window", "localStorage", THEME_SCRIPT)(doc, win, store);
    return attrs["data-theme"];
  };
  it("uses what was chosen, otherwise the device setting", () => {
    expect(run("dark", false)).toBe("dark");
    expect(run("light", true)).toBe("light");
    expect(run(null, true)).toBe("dark");
    expect(run(null, false)).toBe("light");
    expect(run("rubbish", true)).toBe("dark");
  });
  it("falls back to light when storage is blocked", () => {
    expect(run(null, true, true)).toBe("light");
  });
  it("is set in the page head before anything is drawn", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/<head>\s*<script dangerouslySetInnerHTML=\{\{ __html: THEME_SCRIPT \}\} \/>\s*<\/head>/);
    expect(layout).toContain("suppressHydrationWarning");
  });
});

describe("theme switcher", () => {
  it("offers Light and Dark as two buttons in a labelled group", () => {
    const html = renderToStaticMarkup(createElement(ThemeSwitcher));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Colour theme"');
    expect(html).toMatch(/<button[^>]*aria-label="Light theme"/);
    expect(html).toMatch(/<button[^>]*aria-label="Dark theme"/);
    expect(html.match(/<button/g)).toHaveLength(2);
  });
  it("is in the app menus and the public header", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    expect(read("src/components/navbar.tsx").match(/<ThemeSwitcher/g)).toHaveLength(2); // desktop sidebar and phone menu
    expect(read("src/components/site-chrome.tsx")).toContain("<ThemeSwitcher");
  });
});

describe("sign-in frame", () => {
  it("has the start page's look: wordmark, graph paper, margin line, one h1, a card", () => {
    const html = renderToStaticMarkup(createElement(AuthShell, { title: "Welcome back", highlight: "back", note: "Sign in to Idea HQ", children: "x" }));
    expect(html).toContain("Idea HQ");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Welcome <span[^>]*>back<\/span><\/h1>/);
    expect(html).toContain("Sign in to Idea HQ");
    expect(html).toContain("bg-[#F1B5AE]");
    expect(html).toContain("#E8EBF2");
    expect(html).toContain('href="/guide"');
  });
  it("stays on its own light colours, whatever the theme (no theme variables in the frame)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/landing/auth-shell.tsx"), "utf8");
    expect(src).not.toMatch(/\b(?:bg|text|border)-(?:gray|emerald|slate)-\d/);
    expect(src).not.toMatch(/\bdark:/);
  });
  it("is used by the three sign-in screens", () => {
    for (const f of ["signin", "change-password", "verify"]) {
      expect(fs.readFileSync(path.join(process.cwd(), `src/app/auth/${f}/page.tsx`), "utf8"), f).toContain("<AuthShell");
    }
  });
});
