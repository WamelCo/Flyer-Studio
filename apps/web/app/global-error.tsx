"use client";

import { useEffect } from "react";

import { reportError } from "@/lib/monitoring";

/** Last-resort boundary (the root layout itself failed): plain markup, no app chrome. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError(error, { digest: error.digest, boundary: "global" }), [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#F5F5F7", color: "#1D1D1F" }}>
        <main style={{ textAlign: "center", padding: 24, maxWidth: 520 }}>
          <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>Something went wrong.</h1>
          <p style={{ fontSize: 17, color: "#6E6E73", margin: "0 0 24px" }}>Your work is saved. Try again in a moment.</p>
          <button type="button" onClick={reset} style={{ font: "inherit", fontSize: 17, padding: "12px 24px", borderRadius: 999, border: 0, background: "#0071E3", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
