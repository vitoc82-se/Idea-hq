import { SettingsView } from "./settings-view";

export const metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsView />;
}
