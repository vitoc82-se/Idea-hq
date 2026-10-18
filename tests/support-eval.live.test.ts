import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { answerQuestion, type ModelClient } from "@/lib/support/ai";
import { EVAL_CASES, EVAL_NOTES, EVAL_TITLE } from "@/lib/support/eval-set";

// Runs the eval set against the real model. Off by default so normal test runs
// cost nothing: `RUN_SUPPORT_EVAL=1 ANTHROPIC_API_KEY=... npm run support:eval`.
const live = process.env.RUN_SUPPORT_EVAL === "1" && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)("support AI eval (live model)", () => {
  const client = live ? (new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as ModelClient) : (null as unknown as ModelClient);
  for (const c of EVAL_CASES) {
    it(`${c.id} [${c.group}] ${c.q.slice(0, 50)}`, async () => {
      const r = await answerQuestion({ client, title: EVAL_TITLE, notes: EVAL_NOTES, question: c.q });
      if (c.expect === "person") expect(r.kind, JSON.stringify(r)).toBe("person");
      if (c.expect === "answer") {
        expect(r.kind, JSON.stringify(r)).toBe("answer");
        if (c.mustMatch && r.kind === "answer") expect(r.answer).toMatch(c.mustMatch);
      }
      if (r.kind === "answer" && c.mustNotMatch) expect(r.answer).not.toMatch(c.mustNotMatch);
    }, 30000);
  }
});
