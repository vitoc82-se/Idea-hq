import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { process.env.NEXTAUTH_SECRET = "a-test-secret-used-only-by-the-sizes-test"; });
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { SIZE_NAMES, SIZE_PROFILE, sizeName, sizeExpectation, sizeOptionLabel } from "@/lib/runs/sizes";
import { SIZE_GUIDE } from "@/lib/runs/size-guide";
import { TIERS } from "@/lib/runs/policy";
import { COMPLEXITIES } from "@/app/(app)/ideas/ideas-shared";
import { intro, structure, ideaBlock } from "@/lib/runs/plan-prompt";
import GuidePage from "@/app/guide/page";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("sizes are measured in what the AI has to do", () => {
  it("has the four agreed names, and nothing else is shown for an unknown size", () => {
    expect(SIZE_NAMES).toEqual({ S: "Quick", M: "Standard", L: "Large", XL: "Epic" });
    expect(sizeName("M")).toBe("Standard");
    for (const c of [null, undefined, "", "huge", "s"]) {
      expect(sizeName(c)).toBe("");
      expect(sizeExpectation(c)).toBe("");
    }
  });
  it("says turns, minutes and cost, and tells an Epic to be split", () => {
    expect(sizeExpectation("S")).toBe("typically 5 to 15 turns, 3 to 8 minutes, $0.01 to $0.10");
    expect(sizeExpectation("M")).toBe("typically 15 to 35 turns, 6 to 15 minutes, $0.10 to $0.60");
    expect(sizeExpectation("L")).toBe("typically 30 to 60 turns, 12 to 30 minutes, $0.50 to $2.5");
    expect(sizeExpectation("S", { withCost: false })).toBe("typically 5 to 15 turns, 3 to 8 minutes");
    expect(sizeExpectation("XL")).toMatch(/split it into steps first/);
  });
  it("the typical turns of each size fit under the turn limit its model tier gets, with room to spare", () => {
    (["S", "M", "L"] as const).forEach((c, i) => expect(SIZE_PROFILE[c].turns[1], c).toBeLessThanOrEqual(TIERS[i].maxTurns));
    for (const c of ["S", "M", "L", "XL"] as const) expect(SIZE_PROFILE[c].turns[0]).toBeLessThan(SIZE_PROFILE[c].turns[1]);
  });
  it("ranges grow with the size", () => {
    const order = ["S", "M", "L", "XL"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(SIZE_PROFILE[order[i]].turns[0]).toBeGreaterThan(SIZE_PROFILE[order[i - 1]].turns[0]);
      expect(SIZE_PROFILE[order[i]].usd[1]).toBeGreaterThan(SIZE_PROFILE[order[i - 1]].usd[1]);
    }
  });
  it("the size dropdowns show the names, not hours", () => {
    expect(COMPLEXITIES.map((c) => c.value)).toEqual(["S", "M", "L", "XL"]);
    for (const c of COMPLEXITIES) {
      expect(c.label).toBe(sizeOptionLabel(c.value));
      expect(c.label).not.toMatch(/hour|day|week/i);
    }
    expect(COMPLEXITIES[0].label).toMatch(/^Quick: 5 to 15 turns/);
    expect(COMPLEXITIES[3].label).toMatch(/^Epic: split it first/);
  });
});

describe("the estimator judges the AI's work", () => {
  it("describes sizes by AI steps and forbids answers in hours or days", () => {
    expect(SIZE_GUIDE).toMatch(/AI coding agent must do/);
    for (const name of ["Quick", "Standard", "Large", "Epic"]) expect(SIZE_GUIDE).toContain(name);
    expect(SIZE_GUIDE).toMatch(/Never answer in hours or days/);
    expect(SIZE_GUIDE).not.toMatch(/a few hours|~1 day|multi-day/);
    expect(SIZE_GUIDE).toMatch(/sign-in, payments, billing/);
  });
  it("is also what sizes the stories of a split idea", () => {
    expect(read("src/app/api/ideas/[id]/breakdown/route.ts")).toContain("${SIZE_GUIDE}");
  });
  it("is what the estimate route sends", () => {
    const route = read("src/app/api/ideas/[id]/estimate/route.ts");
    expect(route).toContain("${SIZE_GUIDE}");
    expect(route).not.toMatch(/a few hours|how long a human/i.test(route) ? /never/ : /a few hours/);
    expect(route).toMatch(/No hours or days/);
  });
});

describe("the plan is a brief for the workflow's agent", () => {
  it("has no git, branch, merge, push or deploy steps, and no verify-first boilerplate", () => {
    for (const kind of ["idea", "bug"]) {
      const s = structure(kind);
      expect(s).toMatch(/Do NOT write any git, branch, commit, push, merge or deploy steps/);
      expect(s).not.toMatch(/## Verify first|## Data & deploy notes|Create a branch/);
    }
    const idea = structure("idea");
    for (const h of ["## Change", "## Checks", "## Done when"]) expect(idea).toContain(h);
    expect(idea).toMatch(/under 20 lines/);
  });
  it("tells the planner who reads it, and that the workflow does the git work", () => {
    for (const kind of ["idea", "bug"]) {
      const i = intro(kind, "Shop");
      expect(i).toMatch(/runs inside an automated workflow/);
      expect(i).toMatch(/workflow creates the branch/);
      expect(i).not.toMatch(/paste straight into the agent|ships it/);
    }
    expect(ideaBlock({ kind: "idea", title: "T", notes: null, repro: null, severity: null, scope: null, complexity: "S", impact: "low" }, "", "")).toMatch(/Effort: S/);
  });
  it("the plan route no longer asks for a feature branch or deploy flow", () => {
    const route = read("src/app/api/ideas/[id]/plan/route.ts");
    expect(route).toMatch(/The workflow owns git, branches and deploys/);
    expect(route).not.toMatch(/Prefer a feature branch|and deploy flow described/);
    expect(route).toMatch(/base the "Change" section/);
  });
});

describe("sizes show as names everywhere, with the numbers where they help", () => {
  it("no screen prints the raw S/M/L/XL value as the label", () => {
    for (const f of [
      "src/app/(app)/ideas/ideas-board.tsx", "src/app/(app)/ideas/ideas-kanban.tsx", "src/app/(app)/ideas/ideas-stories.tsx",
      "src/app/(app)/focus/page.tsx", "src/app/(app)/ideas/ideas-detail.tsx", "src/app/(app)/ideas/run-panel.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("sizeName(");
      expect(src, f).not.toMatch(/>\s*\{(?:idea|c|i)\.complexity\}\s*</);
      expect(src, f).not.toMatch(/\{idea\.complexity\} effort/);
    }
  });
  it("the approval card and the idea page show what the size typically costs", () => {
    expect(read("src/app/(app)/ideas/run-panel.tsx")).toMatch(/is \{sizeExpectation\(size,/);
    expect(read("src/app/(app)/ideas/ideas-detail.tsx")).toContain("sizeExpectation(idea.complexity)");
  });
  it("the Guide quotes the same ranges", async () => {
    const html = renderToStaticMarkup(await GuidePage()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const c of ["S", "M", "L"] as const) {
      const p = SIZE_PROFILE[c];
      expect(html, c).toContain(`${SIZE_NAMES[c]} (${p.turns[0]} to ${p.turns[1]} turns, ${p.minutes[0]} to ${p.minutes[1]} minutes`);
    }
    expect(html).toContain("Epic (too big for one run");
  });
});
