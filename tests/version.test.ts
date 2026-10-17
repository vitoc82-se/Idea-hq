import { describe, it, expect } from "vitest";
import { formatVersion, APP_VERSION } from "@/lib/version";
import pkg from "../package.json";

describe("formatVersion", () => {
  it("shows just the semver when there is no SHA", () => {
    expect(formatVersion("0.1.0")).toBe("v0.1.0");
    expect(formatVersion("0.1.0", "")).toBe("v0.1.0");
    expect(formatVersion("0.1.0", null)).toBe("v0.1.0");
  });

  it("appends a 7-char SHA when present", () => {
    expect(formatVersion("0.1.0", "a1b2c3d4e5f6a7b8c9d0")).toBe("v0.1.0 · a1b2c3d");
  });

  it("APP_VERSION starts with the package.json version", () => {
    expect(APP_VERSION.startsWith(`v${pkg.version}`)).toBe(true);
  });
});
