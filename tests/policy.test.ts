import { describe, it, expect } from "vitest";
import { recommendTier, resolveTier, planModel, MODEL_IDS, TIERS, PLANNING_MODEL } from "@/lib/runs/policy";

describe("recommendTier", () => {
  it("scales model, effort and turns with idea size", () => {
    expect(recommendTier("S")).toMatchObject({ model: "claude-haiku-5-5", effort: "low", maxTurns: 15 });
    expect(recommendTier("M")).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium", maxTurns: 30 });
    expect(recommendTier("L")).toMatchObject({ model: "claude-opus-5-5", effort: "high", maxTurns: 50 });
    expect(recommendTier("XL")).toMatchObject({ model: "claude-fable-5-1", maxTurns: 80 });
  });
  it("never goes cheaper as the idea gets bigger", () => {
    const idx = ["S", "M", "L", "XL"].map((c) => recommendTier(c).index);
    expect(idx).toEqual([0, 1, 2, 3]);
  });
  it("uses the middle tier when the size is unknown", () => {
    for (const c of [null, undefined, "", "huge"]) expect(recommendTier(c).index).toBe(1);
    expect(recommendTier(null).reason).toMatch(/not estimated/);
  });
  it("project bias shifts one tier and clamps at the ends", () => {
    expect(recommendTier("M", "saver").index).toBe(0);
    expect(recommendTier("S", "saver").index).toBe(0);
    expect(recommendTier("M", "max").index).toBe(2);
    expect(recommendTier("XL", "max").index).toBe(3);
    expect(recommendTier("M", "whatever").index).toBe(1);
  });
  it("steps up after failed attempts, capped", () => {
    expect(recommendTier("S", "auto", 1).index).toBe(1);
    expect(recommendTier("S", "auto", 2).index).toBe(2);
    expect(recommendTier("S", "auto", 99).index).toBe(3);
    expect(recommendTier("M", "auto", 1).reason).toMatch(/stepping up after 1 failed attempt$/);
  });
  it("only ever recommends allowed models", () => {
    for (const t of TIERS) expect(MODEL_IDS).toContain(t.model);
  });
});

describe("resolveTier (user override)", () => {
  const rec = recommendTier("S");
  it("keeps the recommendation when nothing is chosen", () => {
    const r = resolveTier(rec, {});
    expect(r.overridden).toBe(false);
    expect(r.tier).toEqual({ model: rec.model, effort: rec.effort, maxTurns: rec.maxTurns });
  });
  it("applies valid choices", () => {
    const r = resolveTier(rec, { model: "claude-opus-5-5", effort: "max", maxTurns: 60 });
    expect(r).toMatchObject({ overridden: true, tier: { model: "claude-opus-5-5", effort: "max", maxTurns: 60 } });
  });
  it("rejects anything outside the allow-lists, so no flag injection", () => {
    const r = resolveTier(rec, { model: "gpt-4; rm -rf /", effort: "--dangerously-skip-permissions", maxTurns: 100000 });
    expect(r.overridden).toBe(false);
    expect(r.tier.model).toBe(rec.model);
    expect(resolveTier(rec, { maxTurns: 2 }).tier.maxTurns).toBe(rec.maxTurns);
    expect(resolveTier(rec, { maxTurns: "abc" }).tier.maxTurns).toBe(rec.maxTurns);
    expect(resolveTier(rec, { maxTurns: 12.6 }).tier.maxTurns).toBe(13);
  });
});

describe("planning models", () => {
  it("uses the strong model only for big ideas", () => {
    expect(planModel("S")).toBe("claude-sonnet-5-5");
    expect(planModel("M")).toBe("claude-sonnet-5-5");
    expect(planModel("L")).toBe("claude-opus-5-5");
    expect(planModel("XL")).toBe("claude-opus-5-5");
    expect(planModel(null)).toBe("claude-sonnet-5-5");
  });
  it("breaking an idea into stories keeps the strong model", () => {
    expect(PLANNING_MODEL.breakdown).toBe("claude-opus-5-5");
  });
});
