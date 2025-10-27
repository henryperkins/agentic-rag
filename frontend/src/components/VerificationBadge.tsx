import React from "react";

export function VerificationBadge({ verified }: { verified: boolean | null }) {
  if (verified === null) return null;
  return (
    <span className={`badge ${verified ? "success" : "warning"}`} role="status" aria-live="polite">
      {verified ? "✅ Verified" : "⚠️ Low Confidence"}
    </span>
  );
}
