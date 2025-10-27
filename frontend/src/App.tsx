import React from "react";
import { Chat } from "./components/Chat";
import { FileUpload } from "./components/FileUpload";

export default function App() {
  return (
    <div className="app-shell">
      <div className="app-container">
        <header className="app-header" aria-label="Agentic RAG overview">
          <h1 className="app-title">rag-chat</h1>
          <p className="app-subtitle">
            Production-layered Agentic RAG with hybrid retrieval, rerank, self-verification, and feedback streaming with citations.
          </p>
        </header>

        <main className="app-grid" aria-live="polite">
          <article className="card" aria-label="Chat workspace">
            <Chat />
          </article>
          <aside className="card" aria-label="Document management">
            <FileUpload />
          </aside>
        </main>

        <footer className="footer">
          Ports — Backend: <code>8787</code>, Frontend: <code>5173</code>
        </footer>
      </div>
    </div>
  );
}
