import { describe, it, expect, vi, beforeEach } from "vitest";
import { OWNER } from "./helpers";

const update = vi.fn(async (a: { data: { image: string | null } }) => ({ image: a.data.image }));
const sessionRef: { user: { id: string; email: string } | null } = { user: null };
const allowed = { value: true };

vi.mock("@/lib/db", () => ({ db: { user: { update: (a: never) => update(a) } } }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sessionRef.user ? { user: sessionRef.user } : null),
}));
vi.mock("@/lib/access", () => ({ canUse: async () => allowed.value }));

import { PATCH } from "@/app/api/profile/route";
import { avatarError, sessionSafeImage, AVATAR_MAX_LENGTH } from "@/lib/avatar";

const WEBP = "data:image/webp;base64,UklGRg==";

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  update.mockClear();
  sessionRef.user = { id: OWNER.id, email: OWNER.email };
  allowed.value = true;
});

describe("avatarError", () => {
  it("accepts null and png/jpeg/webp data URLs", () => {
    expect(avatarError(null)).toBeNull();
    expect(avatarError(WEBP)).toBeNull();
    expect(avatarError("data:image/png;base64,iVBOR")).toBeNull();
    expect(avatarError("data:image/jpeg;base64,/9j/")).toBeNull();
  });

  it("rejects other types, non-strings and oversized payloads", () => {
    expect(avatarError("data:image/svg+xml;base64,PHN2Zz4=")).toMatch(/PNG, JPEG or WebP/);
    expect(avatarError("https://example.com/a.png")).toMatch(/PNG, JPEG or WebP/);
    expect(avatarError(42)).toMatch(/PNG, JPEG or WebP/);
    expect(avatarError(WEBP + "A".repeat(AVATAR_MAX_LENGTH))).toMatch(/too large/);
  });
});

describe("sessionSafeImage", () => {
  it("keeps short remote URLs but drops data URLs", () => {
    expect(sessionSafeImage("https://lh3.googleusercontent.com/a/x")).toBe("https://lh3.googleusercontent.com/a/x");
    expect(sessionSafeImage(WEBP)).toBeNull();
    expect(sessionSafeImage(null)).toBeNull();
  });
});

describe("PATCH /api/profile", () => {
  it("rejects callers who fail the access gate", async () => {
    allowed.value = false;
    expect((await patch({ image: WEBP })).status).toBe(401);
    sessionRef.user = null;
    expect((await patch({ image: WEBP })).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("saves the image on the caller's own user row", async () => {
    const res = await patch({ image: WEBP });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: WEBP });
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: OWNER.id }, data: { image: WEBP } });
  });

  it("clears the image with null", async () => {
    const res = await patch({ image: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: null });
  });

  it("returns 400 for bad, oversized or missing images", async () => {
    for (const body of [
      { image: "data:text/html;base64,PGI+" },
      { image: WEBP + "A".repeat(AVATAR_MAX_LENGTH) },
      {},
      "not json",
    ]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(update).not.toHaveBeenCalled();
  });
});
