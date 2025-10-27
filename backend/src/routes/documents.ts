// Layer 1: Documents CRUD Routes
import { FastifyInstance } from "fastify";
import { ingestDocument } from "../services/documents";
import { ingestGitHubRepo } from "../services/github";
import { listDocuments, getDocumentById, deleteDocument, getChunksForDocument } from "../db/sql";
import { deleteDocumentQdrant } from "../db/qdrant";
import { USE_DUAL_VECTOR_STORE } from "../config/constants";
import { query } from "../db/client";
import type {
  BatchUploadResult,
  GitHubIngestRequest,
  GitHubIngestResult,
  DocumentWithChunks
} from "../../../shared/types";

export async function documentRoutes(app: FastifyInstance) {
  const isUuid = (value: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);

  app.post("/api/documents/upload", { logLevel: "info" }, async (req, reply) => {
    const mp = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!mp) {
      reply.code(400).send({ error: "No file uploaded" });
      return;
    }
    const filename = mp.filename;
    const source = filename || "upload";
    const content = (await mp.toBuffer()).toString("utf8");
    const title = filename?.replace(/\.(md|txt)$/i, "") || null;
    const result = await ingestDocument(content, title, source);
    reply.send({ ok: true, ...result });
  });

  // Batch upload endpoint
  app.post("/api/documents/upload/batch", { logLevel: "info" }, async (req, reply) => {
    const files = await req.files({ limits: { fileSize: 5 * 1024 * 1024 } });
    const results: BatchUploadResult["results"] = [];
    let successCount = 0;
    let failureCount = 0;

    for await (const file of files) {
      const filename = file.filename;
      const source = filename || "batch-upload";

      try {
        const content = (await file.toBuffer()).toString("utf8");
        const title = filename?.replace(/\.(md|txt)$/i, "") || null;
        const result = await ingestDocument(content, title, source);

        results.push({
          filename,
          success: true,
          documentId: result.documentId,
          chunksInserted: result.chunksInserted
        });
        successCount++;
      } catch (error) {
        results.push({
          filename,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
        failureCount++;
      }
    }

    const response: BatchUploadResult = {
      success: failureCount === 0,
      results,
      totalFiles: results.length,
      successCount,
      failureCount
    };

    reply.send(response);
  });

  // GitHub repository ingestion endpoint
  app.post("/api/documents/github/ingest", { logLevel: "info" }, async (req, reply) => {
    const body = req.body as GitHubIngestRequest;

    if (!body.repoUrl) {
      reply.code(400).send({ error: "repoUrl is required" });
      return;
    }

    try {
      const result = await ingestGitHubRepo(body);
      reply.send(result);
    } catch (error) {
      reply.code(500).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/documents", async (req, reply) => {
    const q = (req.query || {}) as any;
    const limitRaw = q.limit ?? 10;
    const offsetRaw = q.offset ?? 0;

    const limit = Math.max(1, Math.min(100, Number(limitRaw)));
    const offset = Math.max(0, Number(offsetRaw));

    const docs = await listDocuments(limit, offset);
    const totalResult = await query<{ count: string }>("SELECT COUNT(*) as count FROM documents");

    reply.send({
      items: docs,
      total: parseInt(totalResult.rows[0].count, 10),
    });
  });

  app.get("/api/documents/:id/full", async (req, reply) => {
    const id = (req.params as any).id as string;

    if (!isUuid(id)) {
      reply.code(404).send({ error: "Document not found" });
      return;
    }

    const document = await getDocumentById(id);
    if (!document) {
      reply.code(404).send({ error: "Document not found" });
      return;
    }

    const chunks = await getChunksForDocument(id);
    const payload: DocumentWithChunks = {
      ...document,
      chunks
    };

    reply.send(payload);
  });

  app.delete("/api/documents/:id", async (req, reply) => {
    const id = (req.params as any).id as string;

    // Delete from both stores if dual-store is enabled
    if (USE_DUAL_VECTOR_STORE) {
      const results = await Promise.allSettled([
        deleteDocument(id),
        deleteDocumentQdrant(id)
      ]);

      // Check if any deletion failed
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        const errors = failures.map((f) => (f as PromiseRejectedResult).reason instanceof Error
          ? (f as PromiseRejectedResult).reason.message
          : String((f as PromiseRejectedResult).reason));
        app.log.error({ documentId: id, errors }, "Partial deletion failure for document");

        // Return partial success status
        reply.code(207).send({
          ok: false,
          partialSuccess: true,
          message: "Document deleted from some stores but not all",
          errors: errors,
          postgresDeleted: results[0].status === "fulfilled",
          qdrantDeleted: results[1].status === "fulfilled"
        });
        return;
      }
    } else {
      await deleteDocument(id);
    }

    reply.send({ ok: true });
  });
}
