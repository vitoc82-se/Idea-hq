import { logError } from "@/lib/log";
import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/github/webhook";
import { handleWebhook } from "@/lib/runs/engine";

export const dynamic = "force-dynamic";

// GitHub App webhook. Authenticated by HMAC signature only (no session).
export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  const raw = await request.text();
  if (!verifyWebhookSignature(secret, raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") || "";
  const delivery = request.headers.get("x-github-delivery") || "";
  if (!delivery) return NextResponse.json({ error: "Missing delivery id" }, { status: 400 });
  if (event === "ping") return NextResponse.json({ ok: true });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  try {
    const result = await handleWebhook(event, payload, delivery);
    return NextResponse.json({ result });
  } catch (e) {
    logError("webhook error", e, event, delivery);
    // 500 makes GitHub redeliver; the delivery row was cleared by the engine.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
