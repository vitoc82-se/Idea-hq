import { loadPublicSpace, rateStore } from "@/lib/support/public-store";
import { firstExceeded, RULES, clientIp } from "@/lib/support/ratelimit";
import { verifyTurnstile } from "@/lib/support/turnstile";
import { aiAvailable, answerQuestion } from "@/lib/support/ai";
import { supportModelClient } from "@/lib/support/ai-client";
import { hashIdent, signBlob } from "@/lib/support/tokens";
import { cleanText } from "@/lib/support/sanitize";
import { LIMITS } from "@/lib/support/constants";
import { json, readJson, sameOriginOk } from "@/lib/support/http";

// PUBLIC route (no login): a customer asks a question and gets an answer from
// the owner's confirmed help notes, or is sent to a person.
export async function POST(request: Request, { params }: { params: { key: string } }) {
  if (!sameOriginOk(request)) return json({ error: "Forbidden" }, 403);
  const body = await readJson(request, 8_000);
  if (!body) return json({ error: "Invalid request" }, 400);
  const space = await loadPublicSpace(params.key);
  if (!space) return json({ error: "Support is not available" }, 404);

  const ip = clientIp(request.headers);
  const ipKey = hashIdent(ip);
  if (await firstExceeded(rateStore, [RULES.askIp(ipKey)])) return json({ error: "Too many requests" }, 429);

  const question = cleanText(body.question, LIMITS.questionMax);
  if (!question) return json({ error: "Write a question" }, 422);

  if (!(await verifyTurnstile(body.token, ip))) return json({ error: "Verification failed" }, 403);

  if (!aiAvailable({ aiEnabled: space.aiEnabled }, space.notes.length)) {
    return json({ kind: "person", reason: "unavailable" });
  }
  if (await firstExceeded(rateStore, [RULES.aiProjectDay(space.projectId, space.aiDailyCap)])) {
    return json({ kind: "person", reason: "unavailable" });
  }

  const result = await answerQuestion({ client: supportModelClient(), title: space.title, notes: space.notes, question });
  if (result.kind === "answer") {
    const blob = signBlob({ q: question, a: result.answer, k: space.id });
    return json({ kind: "answer", answer: result.answer, blob });
  }
  return json({ kind: "person", reason: result.reason });
}
