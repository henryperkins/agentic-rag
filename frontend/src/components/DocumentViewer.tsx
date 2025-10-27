import { useEffect, useMemo, useState } from "react";
import type { DocumentWithChunks } from "../../../shared/types";

const MAX_OVERLAP_CANDIDATE = 500;

function stitchChunks(chunks: DocumentWithChunks["chunks"]): { content: string; isIncomplete: boolean } {
  if (!chunks.length) return { content: "", isIncomplete: false };

  const ordered = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  let isIncomplete = false;

  const content = ordered.reduce((acc, chunk, index) => {
    if (index === 0) {
      return chunk.content;
    }

    const maxOverlap = Math.min(MAX_OVERLAP_CANDIDATE, acc.length, chunk.content.length);
    let overlap = 0;

    for (let len = maxOverlap; len > 0; len--) {
      if (acc.slice(acc.length - len) === chunk.content.slice(0, len)) {
        overlap = len;
        break;
      }
    }

    if (overlap === 0) {
      isIncomplete = true;
      return acc + "\n\n... [Content Missing] ...\n\n" + chunk.content;
    }

    return acc + chunk.content.slice(overlap);
  }, "");

  return { content, isIncomplete };
}

interface DocumentViewerProps {
  documentId: string;
  onClose: () => void;
}

export function DocumentViewer({ documentId, onClose }: DocumentViewerProps) {
  const [document, setDocument] = useState<DocumentWithChunks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    async function fetchDocument() {
      setLoading(true);
      setError(null);
      setDocument(null);
      try {
        const url = showFull ? `/api/documents/${documentId}/full` : `/api/documents/${documentId}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: DocumentWithChunks = await response.json();
        setDocument(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "An unknown error occurred");
      } finally {
        setLoading(false);
      }
    }

    fetchDocument();
  }, [documentId, showFull]);

  const { content: stitchedContent, isIncomplete } = useMemo(() => {
    if (!document) return { content: "", isIncomplete: false };
    return stitchChunks(document.chunks);
  }, [document]);

  return (
    <div className="document-viewer">
      <div className="toolbar">
        <div className="toolbar-meta">
          <h3>{document?.title || "Document"}</h3>
          {document?.source && <span className="doc-meta">Source: {document.source}</span>}
        </div>
        <button onClick={() => setShowFull(!showFull)} className="toggle-btn">
          {showFull ? "Show Stitched" : "Show Full"}
        </button>
        <button onClick={onClose} className="close-btn">
          Close
        </button>
      </div>
      {loading && <div className="skeleton-loader">Loading...</div>}
      {error && <div className="error-message">Error: {error}</div>}
      {document && (
        <div className="content-container markdown-content">
          {isIncomplete && !showFull && (
            <div className="incomplete-warning">
              This document may be incomplete. <button onClick={() => setShowFull(true)}>Fetch full document</button>.
            </div>
          )}
          <pre>{stitchedContent}</pre>
        </div>
      )}
    </div>
  );
}
