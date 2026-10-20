// Talking to Lemon Squeezy from our side (the other direction is the webhook).
// Needs LEMONSQUEEZY_API_KEY; without it everything here is skipped and the owner
// is told to cancel in the Lemon Squeezy dashboard instead.

export type CancelResult = "cancelled" | "skipped" | "failed";

export function lemonSubscriptionUrl(subscriptionId: string): string {
  return `https://app.lemonsqueezy.com/subscriptions/${encodeURIComponent(subscriptionId)}`;
}

// Stops a subscription at Lemon Squeezy so the person is not charged again.
// A failure never blocks the owner's local switch-off; it is reported back.
export async function cancelLemonSubscription(subscriptionId: string | null): Promise<CancelResult> {
  const key = process.env.LEMONSQUEEZY_API_KEY?.trim();
  if (!key || !subscriptionId || !/^[0-9]+$/.test(subscriptionId)) return "skipped";
  try {
    const res = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${subscriptionId}`, {
      method: "DELETE",
      headers: { Accept: "application/vnd.api+json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? "cancelled" : "failed";
  } catch {
    return "failed";
  }
}
