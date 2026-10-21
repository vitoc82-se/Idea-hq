import Anthropic from "@anthropic-ai/sdk";

// What a person is told when the AI service refuses or fails. The service's own message can name accounts, quota
// or key details, so it goes to the server log (status only) and never to the screen.
export function aiErrorMessage(error: unknown, fallback = "The AI could not do that just now. Try again in a moment."): string {
  if (error instanceof Anthropic.APIError) {
    console.error("AI service error, status", error.status ?? "none");
    const status = error.status ?? 0;
    if (status === 429 || status === 529) return "The AI is busy right now. Wait a minute and try again.";
    if (status === 401 || status === 403) return "The AI service is not available right now. The owner of this Idea HQ has been told.";
    if (status === 413) return "That is too much text for the AI to read. Shorten the idea or the project description and try again.";
    return fallback;
  }
  return fallback;
}
