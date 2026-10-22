import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { effectiveSize, SIZE_FIRST_MESSAGE } from "@/lib/runs/size";
import { PRACTICE_TITLE } from "@/lib/runs/practice";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("an idea has to be sized before the AI implements it", () => {
  it("knows a size when there is one, and does not guess otherwise", () => {
    for (const c of ["S", "M", "L", "XL"]) expect(effectiveSize({ complexity: c, title: "x" })).toBe(c);
    for (const c of [null, undefined, "", "huge", "s"]) expect(effectiveSize({ complexity: c, title: "Add dark mode" })).toBeNull();
    expect(effectiveSize(null)).toBeNull();
    expect(effectiveSize(undefined)).toBeNull();
  });
  it("counts the setup journey's practice idea as small, whatever is stored", () => {
    expect(effectiveSize({ complexity: null, title: PRACTICE_TITLE })).toBe("S");
    expect(effectiveSize({ complexity: "L", title: PRACTICE_TITLE })).toBe("L"); // a size someone set wins
  });
  it("tells the person what to do", () => {
    expect(SIZE_FIRST_MESSAGE).toMatch(/Estimate the build/);
    expect(SIZE_FIRST_MESSAGE).toMatch(/Effort/);
  });
  it("is enforced where runs start and are approved, and the screens use it", () => {
    const engine = read("src/lib/runs/engine.ts");
    expect(engine.match(/effectiveSize\(/g)!.length).toBeGreaterThanOrEqual(3); // start, approve, recommendation
    expect(engine).toMatch(/startRun[^]*?if \(!effectiveSize\(idea\)\) throw new RunError\(409, SIZE_FIRST_MESSAGE\)/);
    expect(engine).toMatch(/approveRun[^]*?if \(run\.ideaId && !effectiveSize\(run\.idea\)\) throw new RunError\(409, SIZE_FIRST_MESSAGE\)/);
    expect(read("src/app/api/ideas/[id]/runs/route.ts")).toContain("sized: !!effectiveSize(idea)");
    // the journey card sizes before planning (or lets the person pick), on the idea page and the welcome pages
    const journey = read("src/app/(app)/ideas/idea-journey.tsx");
    expect(journey).toContain("effectiveSize(current)");
    expect(journey).toContain('id="journey-size"');
    expect(read("src/app/(app)/ideas/ideas-detail.tsx")).toContain("<IdeaJourney");
    expect(read("src/app/welcome/welcome.tsx")).toContain("<IdeaJourney");
  });
});
