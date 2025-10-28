import React, { useEffect, useState } from "react";
import type { DocumentRecord, BatchUploadResult, GitHubIngestRequest, GitHubIngestResult } from "../../../shared/types";
import { DocumentViewer } from "./DocumentViewer";

export function FileUpload() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgVariant, setMsgVariant] = useState<"info" | "success" | "error">("info");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  // GitHub ingestion state
  const [githubUrl, setGithubUrl] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubPath, setGithubPath] = useState("");
  const [githubExtensions, setGithubExtensions] = useState(".md,.txt");
  const [githubMaxFiles, setGithubMaxFiles] = useState("100");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  async function refresh(page = currentPage, size = pageSize) {
    try {
      const limit = size;
      const offset = (page - 1) * size;
      const res = await fetch(`/api/documents?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setDocs(json.items || []);
      setTotal(Number(json.total) || 0);
    } catch (e: any) {
      setMsg(`Failed to refresh documents: ${e?.message || String(e)}`);
      setMsgVariant("error");
      setTimeout(() => setMsg(null), 4000);
    }
  }

  useEffect(() => {
    refresh(currentPage, pageSize);
  }, [currentPage, pageSize]);

  // Handle single or bulk file upload
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const form = new FormData();
    const isBulk = files.length > 1;

    // Add all files to form
    for (let i = 0; i < files.length; i++) {
      form.append("file", files[i]);
    }

    setBusy(true);
    setMsg(isBulk ? `Uploading ${files.length} files...` : "Uploading and embedding…");
    setMsgVariant("info");

    try {
      const endpoint = isBulk ? "/api/documents/upload/batch" : "/api/documents/upload";
      const response = await fetch(endpoint, { method: "POST", body: form });
      const result = isBulk ? (await response.json() as BatchUploadResult) : await response.json();

      if (isBulk) {
        const batchResult = result as BatchUploadResult;
        if (batchResult.success) {
          setMsg(`Successfully uploaded ${batchResult.successCount} files!`);
          setMsgVariant("success");
        } else {
          setMsg(`Uploaded ${batchResult.successCount}/${batchResult.totalFiles} files. ${batchResult.failureCount} failed.`);
          setMsgVariant("error");
        }
      } else {
        setMsg("Uploaded!");
        setMsgVariant("success");
      }

      await refresh();
    } catch (e: any) {
      setMsg("Upload failed: " + e?.message);
      setMsgVariant("error");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3000);
    }
  }

  // Handle GitHub repository ingestion
  async function handleGitHubIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!githubUrl) return;

    setBusy(true);
    setMsg("Fetching repository files...");
    setMsgVariant("info");

    try {
      const request: GitHubIngestRequest = {
        repoUrl: githubUrl,
        branch: githubBranch || "main",
        path: githubPath || undefined,
        fileExtensions: githubExtensions.split(",").map(ext => ext.trim()),
        maxFiles: parseInt(githubMaxFiles) || 100
      };

      const response = await fetch("/api/documents/github/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });

      const result: GitHubIngestResult = await response.json();

      if (result.success) {
        setMsg(`Successfully ingested ${result.documentsCreated} documents from ${result.filesProcessed} files!`);
        setMsgVariant("success");
      } else {
        setMsg(`Ingested ${result.documentsCreated} documents. ${result.errors.length} errors occurred.`);
        setMsgVariant("error");
      }

      await refresh();
      // Reset form
      setGithubUrl("");
      setGithubPath("");
    } catch (e: any) {
      setMsg("GitHub ingestion failed: " + e?.message);
      setMsgVariant("error");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3000);
    }
  }

  async function del(id: string) {
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });

      if (res.status === 207) {
        const detail = await res.json();
        const stores = [
          detail.postgresDeleted === false ? "Postgres" : null,
          detail.qdrantDeleted === false ? "Qdrant" : null
        ].filter(Boolean);
        const storeMsg = stores.length > 0 ? ` (${stores.join(" & ")} incomplete)` : "";
        setMsg(`${detail.message || "Document deletion partially failed"}${storeMsg}`);
        setMsgVariant("error");
      } else if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setMsg(`Delete failed: ${detail?.error || res.statusText || "unknown error"}`);
        setMsgVariant("error");
        return;
      } else {
        setMsg("Document deleted.");
        setMsgVariant("success");
      }

      await refresh();
    } catch (error: any) {
      setMsg(`Delete failed: ${error?.message || String(error)}`);
      setMsgVariant("error");
    } finally {
      setTimeout(() => setMsg(null), 3000);
    }
  }

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paginatedDocs = docs;

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1); // Reset to first page when changing page size
  };

  if (selectedDocumentId) {
    return <DocumentViewer documentId={selectedDocumentId} onClose={() => setSelectedDocumentId(null)} />;
  }

  return (
    <section className="stack">
      <header className="stack">
        <h2>Documents</h2>
        <p>Upload files or ingest from GitHub. New documents are embedded and searchable immediately.</p>
      </header>

      {/* File Upload Section */}
      <div className="stack">
        <h3>Upload Files</h3>
        <input
          type="file"
          accept=".md,.txt"
          onChange={onChange}
          disabled={busy}
          multiple
          aria-label="Upload one or more Markdown or text documents"
        />
        <p className="doc-meta">Supports single or multiple file selection (.md, .txt)</p>
      </div>

      {/* GitHub Ingestion Section */}
      <div className="stack">
        <h3>Ingest from GitHub</h3>
        <form onSubmit={handleGitHubIngest} className="stack">
          <div className="field">
            <label htmlFor="github-url">Repository URL *</label>
            <input
              id="github-url"
              type="text"
              placeholder="https://github.com/owner/repo"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          <div className="field-grid two">
            <div className="field">
              <label htmlFor="github-branch">Branch</label>
              <input
                id="github-branch"
                type="text"
                placeholder="main"
                value={githubBranch}
                onChange={(e) => setGithubBranch(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="github-path">Path (optional)</label>
              <input
                id="github-path"
                type="text"
                placeholder="docs/"
                value={githubPath}
                onChange={(e) => setGithubPath(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
          <div className="field-grid two-uneven">
            <div className="field">
              <label htmlFor="github-extensions">File Extensions</label>
              <input
                id="github-extensions"
                type="text"
                placeholder=".md,.txt"
                value={githubExtensions}
                onChange={(e) => setGithubExtensions(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="github-max-files">Max Files</label>
              <input
                id="github-max-files"
                type="number"
                placeholder="100"
                value={githubMaxFiles}
                onChange={(e) => setGithubMaxFiles(e.target.value)}
                disabled={busy}
                min="1"
                max="1000"
              />
            </div>
          </div>
          <button type="submit" disabled={busy || !githubUrl}>
            Ingest Repository
          </button>
        </form>
      </div>

      {/* Status Message */}
      {msg && <p role="status" aria-live="polite" className={`badge ${msgVariant}`}>{msg}</p>}

      {/* Documents List */}
      <div className="stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3>Uploaded Documents ({total})</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label htmlFor="page-size" style={{ fontSize: "0.9rem" }}>Show:</label>
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
              style={{ padding: "0.25rem 0.5rem" }}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </div>
        </div>

        <ul className="docs-list" aria-live="polite">
          {paginatedDocs.map((d) => (
            <li key={d.id} className="doc-item">
              <div>
                <div className="doc-title">{d.title || "(untitled)"}</div>
                <div className="doc-meta">
                  {d.source || "upload"} — {new Date(d.created_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelectedDocumentId(d.id)}
                >
                  View
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => del(d.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {docs.length === 0 && <li className="doc-meta">No documents yet. Upload a file or ingest from GitHub to get started.</li>}
        </ul>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="secondary"
              style={{ padding: "0.5rem 1rem" }}
            >
              Previous
            </button>

            <div style={{ display: "flex", gap: "0.25rem" }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                // Show first page, last page, current page, and pages around current
                const showPage =
                  page === 1 ||
                  page === totalPages ||
                  Math.abs(page - currentPage) <= 1;

                const showEllipsis =
                  (page === 2 && currentPage > 3) ||
                  (page === totalPages - 1 && currentPage < totalPages - 2);

                if (showEllipsis) {
                  return <span key={page} style={{ padding: "0.5rem" }}>...</span>;
                }

                if (!showPage) {
                  return null;
                }

                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => goToPage(page)}
                    disabled={page === currentPage}
                    className={page === currentPage ? "" : "secondary"}
                    style={{
                      padding: "0.5rem 0.75rem",
                      minWidth: "2.5rem"
                    }}
                  >
                    {page}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="secondary"
              style={{ padding: "0.5rem 1rem" }}
            >
              Next
            </button>

            <span className="doc-meta" style={{ marginLeft: "1rem" }}>
              Page {currentPage} of {totalPages}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
