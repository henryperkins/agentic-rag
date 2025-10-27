import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
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

  const { logs, rewrite, text, citations, verified, webSearchMeta, busy, send } = useChat();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const allowedDomains = domainFilter
      .split(",")
      .map(d => d.trim())
      .filter(d => d.length > 0);

    await send(input.trim(), agentic, hybrid, webSearch, allowedDomains.length > 0 ? allowedDomains : undefined);
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
            onChange={(e) => setDomainFilter(e.target.value)}
            aria-label="Domain filter"
          />
          <small>Leave empty to search all domains</small>
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
      >
        {text ? (
          <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
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
