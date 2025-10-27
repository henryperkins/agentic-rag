import React, { useState } from "react";
import { useChat } from "../hooks/useChat";
import { VerificationBadge } from "./VerificationBadge";
import { Feedback } from "./Feedback";

function safeDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function Chat() {
  const [input, setInput] = useState("");
  const [agentic, setAgentic] = useState(true);
  const [hybrid, setHybrid] = useState(true);
  const [webSearch, setWebSearch] = useState(true);

  const { logs, rewrite, text, citations, verified, busy, send } = useChat();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    await send(input.trim(), agentic, hybrid, webSearch);
  }

  return (
    <section className="stack">
      <header className="stack" aria-live="polite">
        <h2>Chat</h2>
        <p>Ask the agentic orchestrator a question. Hybrid retrieval and verification ensure grounded responses.</p>
      </header>

      <form onSubmit={onSubmit} className="chat-form" aria-label="Ask a question">
        <input
          placeholder="Ask a question…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          name="question"
          aria-label="Question"
          autoComplete="off"
          required
        />
        <button type="submit" disabled={busy} aria-live="polite">
          {busy ? "Thinking…" : "Send"}
        </button>
      </form>

      <div className="switch-group" role="group" aria-label="Retrieval options">
        <label className="switch">
          <input
            type="checkbox"
            checked={agentic}
            onChange={(e) => setAgentic(e.target.checked)}
            aria-checked={agentic}
          />
          <span>Agentic RAG</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={hybrid}
            onChange={(e) => setHybrid(e.target.checked)}
            aria-checked={hybrid}
          />
          <span>Hybrid Search</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={webSearch}
            onChange={(e) => setWebSearch(e.target.checked)}
            aria-checked={webSearch}
          />
          <span>Web Search</span>
        </label>
        <VerificationBadge verified={verified} />
      </div>

      {rewrite && (
        <div>
          <strong>Rewritten query:</strong> <em>{rewrite.rewritten}</em>
        </div>
      )}

      <section
        className="chat-output"
        aria-live="polite"
        aria-busy={busy}
        aria-label="Assistant response"
      >
        {text || "Ask something to get started."}
      </section>

      {citations.length > 0 && (
        <section className="stack" aria-label="Citations">
          <h3>Citations</h3>
          <ul className="citation-list">
            {citations.map((c, i) => (
              <li key={`${c.document_id}:${c.chunk_index}:${i}`}>
                <span>doc <code>{c.document_id.slice(0, 8)}</code></span>
                <span>chunk #{c.chunk_index}</span>
                {c.source ? (
                  /^https?:\/\//i.test(c.source) ? (
                    <span>
                      —
                      {" "}
                      <a href={c.source} target="_blank" rel="noopener noreferrer">
                        {safeDisplayUrl(c.source)}
                      </a>
                    </span>
                  ) : (
                    <span>— {c.source}</span>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!busy && text && (
        <section className="stack" aria-label="Feedback">
          <Feedback question={input} />
        </section>
      )}

      <section className="stack" aria-label="Agent logs">
        <h3>Agent Logs</h3>
        <ul className="agent-logs">
          {logs.map((l, i) => (
            <li key={i}>
              <strong className="agent-role">{l.role}:</strong>
              <span>{l.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
