import React, { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
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
  const [domainFilter, setDomainFilter] = useState("");
  const [showDomainFilter, setShowDomainFilter] = useState(false);
  const [webMaxResults, setWebMaxResults] = useState(5);
  const [domainError, setDomainError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const { logs, rewrite, text, citations, verified, webSearchMeta, busy, send, stop } = useChat();

  const domainPattern = useMemo(() => /^[a-z0-9.-]+\.[a-z]{2,}$/i, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;

    const rawDomains = domainFilter
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    const validDomains = rawDomains.filter((d) => domainPattern.test(d));
    const invalidDomains = rawDomains.filter((d) => !domainPattern.test(d));
    const truncatedDomains = validDomains.slice(0, 20);

    if (invalidDomains.length || validDomains.length > truncatedDomains.length) {
      const invalidMsg = invalidDomains.length ? `Ignored invalid domains: ${invalidDomains.join(", ")}.` : "";
      const truncatedMsg = validDomains.length > truncatedDomains.length ? " Limited to the first 20 domains." : "";
      setDomainError(`${invalidMsg}${truncatedMsg}`.trim());
    } else {
      setDomainError(null);
    }

    await send(
      input.trim(),
      agentic,
      hybrid,
      webSearch,
      truncatedDomains.length > 0 ? truncatedDomains : undefined,
      webMaxResults
    );
    outputRef.current?.focus();
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
          disabled={busy}
          required
        />
        <div className="chat-actions">
          <button type="submit" disabled={busy} aria-live="polite">
            {busy ? "Thinking…" : "Send"}
          </button>
          {busy && (
            <button type="button" className="secondary" onClick={stop} aria-label="Stop current response">
              Stop
            </button>
          )}
        </div>
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
        <button
          type="button"
          className="domain-filter-toggle"
          onClick={() => setShowDomainFilter(!showDomainFilter)}
          aria-pressed={showDomainFilter}
          title="Filter web search to specific domains"
        >
          🌐 {showDomainFilter ? "Hide" : "Filter"}
        </button>
        <VerificationBadge verified={verified} />
      </div>

      {showDomainFilter && (
        <div className="domain-filter-input stack">
          <label htmlFor="domain-filter">
            <strong>Allowed Domains</strong> (comma-separated, max 20)
          </label>
          <input
            id="domain-filter"
            type="text"
            placeholder="wikipedia.org, github.com, stackoverflow.com"
            value={domainFilter}
            onChange={(e) => {
              setDomainFilter(e.target.value);
              setDomainError(null);
            }}
            aria-label="Domain filter"
          />
          {domainError && (
            <p role="status" aria-live="polite" className="error-message">
              {domainError}
            </p>
          )}
          <small>Leave empty to search all domains</small>
        </div>
      )}

      {showDomainFilter && (
        <div className="domain-filter-input stack">
          <label htmlFor="max-results-filter">
            <strong>Max Results</strong> (1-8)
          </label>
          <input
            id="max-results-filter"
            type="number"
            min="1"
            max="8"
            value={webMaxResults}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              setWebMaxResults(isNaN(value) || value < 1 || value > 8 ? 5 : value);
            }}
            aria-label="Max results filter"
          />
        </div>
      )}

      {rewrite && (
        <div>
          <strong>Rewritten query:</strong> <em>{rewrite.rewritten}</em>
        </div>
      )}

      <section
        className="chat-output markdown-content"
        aria-live="polite"
        aria-busy={busy}
        aria-label="Assistant response"
        tabIndex={-1}
        ref={outputRef}
      >
        {text ? (
          <ReactMarkdown>
            {text}
          </ReactMarkdown>
        ) : (
          "Ask something to get started."
        )}
      </section>

      {webSearchMeta && (
        <section className="stack" aria-label="Web Search Info">
          <h3>🔍 Web Search</h3>
          <div className="web-search-meta">
            {webSearchMeta.searchQuery && (
              <p>
                <strong>Query:</strong> "{webSearchMeta.searchQuery}"
              </p>
            )}
            {webSearchMeta.domainsSearched && webSearchMeta.domainsSearched.length > 0 && (
              <p>
                <strong>Domains Searched:</strong> {webSearchMeta.domainsSearched.join(", ")}
              </p>
            )}
            {webSearchMeta.allSources && webSearchMeta.allSources.length > 0 && (
              <details>
                <summary>
                  <strong>Sources Consulted ({webSearchMeta.allSources.length})</strong>
                </summary>
                <ul className="sources-list">
                  {webSearchMeta.allSources.map((url, i) => (
                    <li key={i}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {safeDisplayUrl(url)}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>
      )}

      {citations.length > 0 && (
        <section className="stack" aria-label="Citations">
          <h3>Citations</h3>
          <ul className="citation-list">
            {citations.map((c, i) => (
              <li key={`${c.document_id}:${c.chunk_index}:${i}`}>
                {c.isWebSource && <span className="web-badge">🌐 Web</span>}
                {c.source && c.source.startsWith("http") ? (
                  <a href={c.source} target="_blank" rel="noopener noreferrer">
                    {safeDisplayUrl(c.source)}
                  </a>
                ) : (
                  <span>{c.source || c.document_id}</span>
                )}
                <span className="chunk-index"> (chunk {c.chunk_index})</span>
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
