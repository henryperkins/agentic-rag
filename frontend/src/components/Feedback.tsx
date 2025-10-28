import React, { useState } from "react";

type FeedbackStatus = "idle" | "sending" | "success" | "error";

export function Feedback({ question }: { question: string }) {
  const [status, setStatus] = useState<FeedbackStatus>("idle");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(rating: "up" | "down") {
    if (status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment, question })
      });
      if (!res.ok) {
        throw new Error(`Feedback failed (${res.status})`);
      }
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  if (status === "success") {
    return (
      <p role="status" aria-live="polite" className="badge success">
        Thanks for the feedback!
      </p>
    );
  }

  return (
    <div className="feedback-row">
      <button type="button" onClick={() => send("up")} title="Good answer" disabled={status === "sending"}>
        👍
      </button>
      <button type="button" onClick={() => send("down")} title="Needs work" disabled={status === "sending"}>
        👎
      </button>
      <input
        placeholder="Optional comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        name="feedback-comment"
        aria-label="Optional feedback comment"
        disabled={status === "sending"}
      />
      {status === "error" && error && (
        <p role="status" aria-live="polite" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}
