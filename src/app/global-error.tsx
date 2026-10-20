"use client";

// The last safety net: used only when the page shell itself fails, so it carries its own html and styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", color: "#10201A", background: "#FFFFFF" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "80px 16px" }}>
          <h1 style={{ fontSize: 30, margin: 0 }}>Idea HQ could not open</h1>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#2C3D36" }}>
            Something failed on our side. What you saved is safe. Try again in a moment, and if it keeps failing, tell the owner
            {error.digest ? ` and mention this code: ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ minHeight: 48, padding: "0 24px", fontSize: 16, fontWeight: 600, color: "#FFFFFF", background: "#047857", border: 0, borderRadius: 12, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
