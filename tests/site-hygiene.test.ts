import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Things that keep the site looking finished: every page has a real title, icons
// exist and belong to this app, search engines get only the public pages, and no
// leftovers (debug logging, generic error text, names from other apps) slip back in.
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "generated") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}
const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("page titles", () => {
  const pages = files.filter((f) => /\/page\.tsx$/.test(f) && !f.includes("/api/"));
  it("finds the pages", () => expect(pages.length).toBeGreaterThan(10));
  for (const page of pages) {
    const rel = path.relative(SRC, page);
    it(`${rel} has its own title (itself or a layout above it)`, () => {
      const dirs: string[] = [];
      let d = path.dirname(page);
      while (d.startsWith(path.join(SRC, "app")) && d !== path.join(SRC, "app")) { dirs.push(d); d = path.dirname(d); }
      const candidates = [page, ...dirs.map((x) => path.join(x, "layout.tsx"))].filter((f) => fs.existsSync(f));
      const hasTitle = candidates.some((f) => /export const metadata[^]*?title\b|export (async )?function generateMetadata/.test(read(f)));
      expect(hasTitle).toBe(true);
    });
  }
  it("no title is generic", () => {
    const titles = files.flatMap((f) => Array.from(read(f).matchAll(/title:\s*(?:\{\s*absolute:\s*)?"([^"]+)"/g)).map((m) => m[1]));
    for (const t of titles.filter((x) => x.length < 40)) expect(t).not.toMatch(/^(untitled|page|home|app|document|undefined|react app)$/i);
  });
  it("the root layout has a title template, a description, a base URL and social tags", () => {
    const s = read(path.join(SRC, "app/layout.tsx"));
    expect(s).toMatch(/template:\s*"%s · Idea HQ"/);
    expect(s).toMatch(/description:/);
    expect(s).toMatch(/metadataBase:\s*new URL\("https:\/\/ideahq\.cloud"\)/);
    expect(s).toMatch(/openGraph:/);
    expect(s).toMatch(/summary_large_image/);
  });
  it("public pages set a canonical address and signed-in pages stay out of search", () => {
    expect(read(path.join(SRC, "app/page.tsx"))).toMatch(/canonical:\s*"\/"/);
    expect(read(path.join(SRC, "app/guide/page.tsx"))).toMatch(/canonical:\s*"\/guide"/);
    expect(read(path.join(SRC, "app/auth/signin/layout.tsx"))).toMatch(/canonical:\s*"\/auth\/signin"/);
    expect(read(path.join(SRC, "app/(app)/layout.tsx"))).toMatch(/index:\s*false/);
  });
  it("the page can be zoomed (no maximum scale, no blocked pinch)", () => {
    const s = read(path.join(SRC, "app/layout.tsx"));
    expect(s).not.toMatch(/maximumScale|userScalable/);
  });
});

describe("icons and manifest", () => {
  it("favicon.ico is a real ICO with 16 and 32 pixel images", () => {
    const b = fs.readFileSync(path.join(SRC, "app/favicon.ico"));
    expect(b.readUInt16LE(0)).toBe(0);
    expect(b.readUInt16LE(2)).toBe(1);
    const n = b.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, i) => b.readUInt8(6 + i * 16) || 256);
    expect(sizes).toEqual(expect.arrayContaining([16, 32]));
  });
  it("every icon the manifest and layout name exists with the right size", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/manifest.json"), "utf8"));
    expect(manifest.name).toBe("Idea HQ");
    expect(manifest.description).not.toMatch(/effort\/value/);
    for (const icon of manifest.icons) {
      const f = path.join(ROOT, "public", icon.src);
      expect(fs.existsSync(f), icon.src).toBe(true);
      const b = fs.readFileSync(f);
      expect(b.subarray(1, 4).toString()).toBe("PNG");
      const [w, h] = icon.sizes.split("x").map(Number);
      expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([w, h]);
    }
    const apple = fs.readFileSync(path.join(ROOT, "public/icons/apple-touch-icon.png"));
    expect([apple.readUInt32BE(16), apple.readUInt32BE(20)]).toEqual([180, 180]);
    expect(fs.readFileSync(path.join(ROOT, "public/icons/icon.svg"), "utf8")).toMatch(/<svg/);
  });
  it("the public Help pages carry the favicon too", () => {
    const s = read(path.join(SRC, "lib/support/page-shell.ts"));
    expect(s).toMatch(/rel="icon" href="\/favicon\.ico"/);
  });
  it("there is a social preview image and a custom 404 and error page", () => {
    for (const f of ["app/opengraph-image.tsx", "app/not-found.tsx", "app/error.tsx", "app/global-error.tsx", "app/robots.ts", "app/sitemap.ts"]) {
      expect(fs.existsSync(path.join(SRC, f)), f).toBe(true);
    }
    expect(read(path.join(SRC, "app/opengraph-image.tsx"))).toMatch(/1200/);
  });
});

describe("search engines", () => {
  it("sitemap lists only public pages and robots keeps the private ones out", async () => {
    const sitemap = (await import("@/app/sitemap")).default();
    const urls = sitemap.map((s) => s.url);
    expect(urls).toEqual(["https://ideahq.cloud/", "https://ideahq.cloud/guide", "https://ideahq.cloud/auth/signin"]);
    const robots = (await import("@/app/robots")).default();
    const rule = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
    for (const p of ["/api/", "/ideas", "/projects", "/billing", "/users", "/support", "/t/", "/widget/", "/help/"]) {
      expect(rule.disallow, p).toContain(p);
    }
    expect(robots.sitemap).toBe("https://ideahq.cloud/sitemap.xml");
  });
});

describe("leftovers", () => {
  const code = files.filter((f) => !f.includes("/tests/"));
  it("no console.log, console.debug or console.info in the app", () => {
    for (const f of code) expect(read(f), path.relative(ROOT, f)).not.toMatch(/console\.(log|debug|info)\(/);
  });
  it("browser code never writes to the console", () => {
    for (const f of code.filter((x) => x.endsWith(".tsx") && read(x).includes('"use client"'))) {
      expect(read(f), path.relative(ROOT, f)).not.toMatch(/console\.(error|warn)\(/);
    }
  });
  it("no generic error text", () => {
    for (const f of code) expect(read(f), path.relative(ROOT, f)).not.toMatch(/Something went wrong|Failed to (?:create|save|update|delete|fetch|estimate|generate|break)|"Unauthorized"/);
  });
  it("nothing from the earlier apps this was built from shows up", () => {
    for (const f of [...code, path.join(ROOT, "public/manifest.json"), path.join(ROOT, "public/sw.js")]) {
      expect(read(f), path.relative(ROOT, f)).not.toMatch(/nutritrack|placeholder="[Ss]napmeal"/i);
    }
  });
});
