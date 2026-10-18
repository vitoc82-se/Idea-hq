import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "./ai";

export function supportModelClient(): ModelClient {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 0 }) as unknown as ModelClient;
}
