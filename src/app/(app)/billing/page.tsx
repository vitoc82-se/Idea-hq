import { BillingView } from "./billing-view";

export const metadata = { title: "Billing" };

export const dynamic = "force-dynamic";

export default function BillingPage() {
  return <BillingView />;
}
