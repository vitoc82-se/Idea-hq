import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { normalizeEmail, cleanText } from "@/lib/support/sanitize";
import { ipFrom, registerBlocked } from "@/lib/auth-limits";
import { verifyTurnstile } from "@/lib/support/turnstile";
import { sendVerificationEmail } from "@/lib/email-verification";

// bcrypt only reads the first 72 bytes of a password, so longer ones add nothing and cost time.
const PASSWORD_MAX_BYTES = 72;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    const { name, email: rawEmail, password, token } = body as Record<string, unknown>;

    // The address is stored in one standard form (trimmed, lower case): "Ann@X.se" and
    // " ann@x.se" are the same person, and must never become a second account. Owner
    // access depends on this (see src/lib/owner.ts).
    const email = normalizeEmail(rawEmail);
    if (!email) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    // Brakes before anything slow: by address and by email, then the "are you a person" check.
    const ip = ipFrom(request.headers);
    if (await registerBlocked(ip, email)) {
      return NextResponse.json({ error: "Too many sign-up attempts from here. Try again in an hour." }, { status: 429 });
    }
    // REGISTER_CAPTCHA=off is an emergency switch (for example if the check is down).
    if (process.env.REGISTER_CAPTCHA !== "off" && !(await verifyTurnstile(token, ip))) {
      return NextResponse.json({ error: "Please complete the check and try again." }, { status: 403 });
    }
    if (typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
      return NextResponse.json({ error: "Password must be at most 72 characters" }, { status: 400 });
    }
    if (name !== undefined && name !== null && typeof name !== "string") {
      return NextResponse.json({ error: "Enter your name as text" }, { status: 400 });
    }

    // Case-insensitive, so accounts created before this rule (with capitals) also count.
    const existing = await db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await db.user.create({
      data: {
        name: typeof name === "string" ? cleanText(name, 80) || null : null,
        email,
        password: hashedPassword,
      },
    });

    // Best effort: a mail problem never blocks sign-up (they can ask for the email again).
    await sendVerificationEmail({ id: user.id, email: user.email, name: user.name }).catch(() => false);

    return NextResponse.json({ message: "Account created successfully", userId: user.id }, { status: 201 });
  } catch (error) {
    // Only the error's kind: a database error can carry the submitted values.
    console.error("Registration error:", (error as Error)?.name);
    return NextResponse.json({ error: "Registration failed. Please try again later." }, { status: 500 });
  }
}
