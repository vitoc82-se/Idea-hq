import { ImageResponse } from "next/og";

export const alt = "Idea HQ: write down ideas, review the finished changes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The picture people see when the link is shared (chat apps, social feeds).
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0B1310",
          color: "#E6EFEA",
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", width: 56, height: 56, borderRadius: 14, background: "#34D399", alignItems: "center", justifyContent: "center" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#04281D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
            </svg>
          </div>
          <div style={{ display: "flex", marginLeft: 18, fontSize: 34 }}>Idea HQ</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 84, lineHeight: 1.05, letterSpacing: -2 }}>Ideas in.</div>
          <div style={{ display: "flex", fontSize: 84, lineHeight: 1.05, letterSpacing: -2, color: "#34D399" }}>Reviewed changes out.</div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 28, lineHeight: 1.4, color: "#B7C7BF" }}>
            An AI builds your ideas inside your own GitHub. You approve every change.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: "#9DB1A8" }}>
          <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: "#34D399", color: "#04281D", fontWeight: 700, fontSize: 22 }}>Ready for review</div>
          <div style={{ display: "flex", marginLeft: 18 }}>4 files changed · all checks passed</div>
        </div>
      </div>
    ),
    size
  );
}
