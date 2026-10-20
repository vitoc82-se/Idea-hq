import { ImageResponse } from "next/og";
import { loadChangelog } from "@/lib/changelog/public-store";

export const alt = "What's new";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The picture people see when a project's What's new page is shared.
export default async function Image({ params }: { params: { key: string } }) {
  const c = await loadChangelog(params.key);
  const name = c?.name ?? "What's new";
  const lines = (c?.entries ?? []).slice(0, 3).map((e) => e.title.slice(0, 70));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0B1310", color: "#E6EFEA", padding: "64px 72px" }}>
        <div style={{ display: "flex", fontSize: 34, color: "#9DB1A8" }}>{name.slice(0, 60)}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 92, lineHeight: 1.05, letterSpacing: -2 }}>What&apos;s new</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 28, fontSize: 30, lineHeight: 1.5, color: "#B7C7BF" }}>
            {lines.length ? lines.map((l, i) => <div key={i} style={{ display: "flex" }}>{`• ${l}`}</div>) : <div style={{ display: "flex" }}>Changes and fixes, newest first.</div>}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#9DB1A8" }}>Powered by Idea HQ</div>
      </div>
    ),
    size
  );
}
