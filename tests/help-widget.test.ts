import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Idea HQ's own Help button must not appear on a project's public What's new page.
const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
vi.mock("next/script", () => ({ default: (p: { src: string }) => createElement("script", { "data-src": p.src }) }));

import { HelpWidget } from "@/components/help-widget";

describe("HelpWidget", () => {
  it("loads on Idea HQ's own pages", () => {
    for (const p of ["/", "/guide", "/ideas", "/auth/signin"]) {
      nav.path = p;
      expect(renderToStaticMarkup(createElement(HelpWidget)), p).toContain("embed/ihq_");
    }
  });
  it("stays off a project's public What's new page", () => {
    nav.path = "/changes/ihq_c_AAAAAAAAAAAAAAAA";
    expect(renderToStaticMarkup(createElement(HelpWidget))).toBe("");
  });
});
