import { useEffect, useMemo, useState } from "react";
import type { DocumentWithChunks } from "../../../shared/types";

const MAX_OVERLAP_CANDIDATE = 500;

function stitchChunks(chunks: DocumentWithChunks["chunks"]): string {
  if (!chunks.length) return "";

  const ordered = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);

  return ordered.reduce((acc, chunk, index) => {
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

    return acc + chunk.content.slice(overlap);
  }, "");
}

interface DocumentViewerProps {
  documentId: string;
  onClose: () => void;
}

export function DocumentViewer({ documentId, onClose }: DocumentViewerProps) {
  const [document, setDocument] = useState<DocumentWithChunks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDocument() {
      setLoading(true);
      setError(null); // Clear any previous errors
      setDocument(null); // Clear previous document to prevent stale content
      try {
        const response = await fetch(`/api/documents/${documentId}/full`);
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
  }, [documentId]);

  const stitchedContent = useMemo(() => {
    if (!document) return "";
    return stitchChunks(document.chunks);
  }, [document]);

  return (
    <div className="document-viewer">
      <div className="toolbar">
        <div className="toolbar-meta">
          <h3>{document?.title || "Document"}</h3>
          {document?.source && <span className="doc-meta">Source: {document.source}</span>}
        </div>
        <button onClick={onClose} className="close-btn">
          Close
        </button>
      </div>
      {loading && <div className="skeleton-loader">Loading...</div>}
      {error && <div className="error-message">Error: {error}</div>}
      {document && (
        <div className="content-container markdown-content">
          <pre>{stitchedContent}</pre>
        </div>
      )}
    </div>
  );
}
