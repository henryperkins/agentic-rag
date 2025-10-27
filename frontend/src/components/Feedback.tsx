import React, { useState } from "react";

export function Feedback({ question }: { question: string }) {
  const [sent, setSent] = useState(false);
  const [comment, setComment] = useState("");

  async function send(rating: "up" | "down") {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, comment, question })
    });
    setSent(true);
  }

  if (sent) {
    return (
      <p role="status" aria-live="polite" className="badge success">
        Thanks for the feedback!
      </p>
    );
  }

  return (
    <div className="feedback-row">
      <button type="button" onClick={() => send("up")} title="Good answer">
        👍
      </button>
      <button type="button" onClick={() => send("down")} title="Needs work">
        👎
      </button>
      <input
        placeholder="Optional comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        name="feedback-comment"
        aria-label="Optional feedback comment"
      />
    </div>
  );
}
