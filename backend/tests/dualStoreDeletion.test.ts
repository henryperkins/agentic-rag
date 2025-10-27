import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { documentRoutes } from "../src/routes/documents";
import * as sql from "../src/db/sql";
import * as qdrant from "../src/db/qdrant";

// Mock constants to enable dual-store
vi.mock("../src/config/constants", async () => {
  const actual = await vi.importActual("../src/config/constants");
  return {
    ...actual,
    USE_DUAL_VECTOR_STORE: true,
  };
});

// Mock middleware
vi.mock("../src/middleware/security", () => ({
  onRequestRateLimit: vi.fn(async () => {}),
  preHandlerAuth: vi.fn(async () => {}),
}));

describe("Dual Store Deletion Handling", () => {
  let app: any;

  beforeEach(async () => {
    app = Fastify();
    await documentRoutes(app);
    vi.clearAllMocks();
  });

  describe("DELETE /api/documents/:id - Success Cases", () => {
    it("should delete from both stores successfully", async () => {
      const documentId = "doc-123";

      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);

      // Both stores should be called
      expect(sql.deleteDocument).toHaveBeenCalledWith(documentId);
      expect(qdrant.deleteDocumentQdrant).toHaveBeenCalledWith(documentId);
    });

    it("should use Promise.allSettled for parallel deletion", async () => {
      const documentId = "doc-parallel";

      let pgDeleted = false;
      let qdrantDeleted = false;

      vi.spyOn(sql, "deleteDocument").mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        pgDeleted = true;
      });

      vi.spyOn(qdrant, "deleteDocumentQdrant").mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        qdrantDeleted = true;
      });

      const startTime = Date.now();
      await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });
      const duration = Date.now() - startTime;

      // Should execute in parallel (~50ms), not sequential (~100ms)
      expect(duration).toBeLessThan(100);
      expect(pgDeleted).toBe(true);
      expect(qdrantDeleted).toBe(true);
    });
  });

  describe("DELETE /api/documents/:id - Partial Failure", () => {
    it("should return HTTP 207 when Postgres succeeds but Qdrant fails", async () => {
      const documentId = "doc-partial-1";

      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockRejectedValue(
        new Error("Qdrant connection timeout")
      );

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      expect(response.statusCode).toBe(207); // Multi-Status

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.partialSuccess).toBe(true);
      expect(body.postgresDeleted).toBe(true);
      expect(body.qdrantDeleted).toBe(false);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0]).toContain("Qdrant connection timeout");
      expect(body.message).toContain("deleted from some stores but not all");
    });

    it("should return HTTP 207 when Qdrant succeeds but Postgres fails", async () => {
      const documentId = "doc-partial-2";

      vi.spyOn(sql, "deleteDocument").mockRejectedValue(
        new Error("Foreign key constraint violation")
      );
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      expect(response.statusCode).toBe(207);

      const body = JSON.parse(response.body);
      expect(body.postgresDeleted).toBe(false);
      expect(body.qdrantDeleted).toBe(true);
      expect(body.errors[0]).toContain("Foreign key constraint violation");
    });

    it("should handle both stores failing", async () => {
      const documentId = "doc-both-fail";

      vi.spyOn(sql, "deleteDocument").mockRejectedValue(
        new Error("Postgres error")
      );
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockRejectedValue(
        new Error("Qdrant error")
      );

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      expect(response.statusCode).toBe(207);

      const body = JSON.parse(response.body);
      expect(body.postgresDeleted).toBe(false);
      expect(body.qdrantDeleted).toBe(false);
      expect(body.errors).toHaveLength(2);
      expect(body.errors.some((e: string) => e.includes("Postgres error"))).toBe(true);
      expect(body.errors.some((e: string) => e.includes("Qdrant error"))).toBe(true);
    });
  });

  describe("Deletion Error Handling", () => {
    it("should extract error messages correctly", async () => {
      const documentId = "doc-error-format";

      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockRejectedValue(
        new Error("Detailed Qdrant error message")
      );

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      const body = JSON.parse(response.body);
      expect(body.errors[0]).toBe("Detailed Qdrant error message");
    });

    it("should handle non-Error rejections", async () => {
      const documentId = "doc-string-error";

      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockRejectedValue(
        "String error message"
      );

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      const body = JSON.parse(response.body);
      expect(body.errors[0]).toBe("String error message");
    });
  });

  describe("Idempotency", () => {
    it("should handle deleting non-existent documents gracefully", async () => {
      const documentId = "non-existent-doc";

      // Both deletes succeed (no-op for non-existent data)
      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });

    it("should allow repeated deletion attempts", async () => {
      const documentId = "doc-repeat";

      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockResolvedValue(undefined);

      // First deletion
      const response1 = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });
      expect(response1.statusCode).toBe(200);

      // Second deletion (should also succeed)
      const response2 = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });
      expect(response2.statusCode).toBe(200);
    });
  });

  describe("Cascade Deletion", () => {
    it("should delete document and all associated chunks", async () => {
      const documentId = "doc-with-chunks";

      const deleteDocSpy = vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      const deleteQdrantSpy = vi.spyOn(qdrant, "deleteDocumentQdrant").mockResolvedValue(undefined);

      await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      // Should delete by document ID (Postgres cascades to chunks)
      expect(deleteDocSpy).toHaveBeenCalledWith(documentId);

      // Qdrant should filter by document_id in payload
      expect(deleteQdrantSpy).toHaveBeenCalledWith(documentId);
    });
  });

  describe("Response Format Validation", () => {
    it("should return correct success response format", async () => {
      const documentId = "doc-success-format";

      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      const body = JSON.parse(response.body);

      expect(body).toEqual({
        ok: true,
      });
    });

    it("should return correct partial failure response format", async () => {
      const documentId = "doc-partial-format";

      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockRejectedValue(
        new Error("Test error")
      );

      const response = await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      const body = JSON.parse(response.body);

      expect(body).toMatchObject({
        ok: false,
        partialSuccess: true,
        message: expect.stringContaining("deleted from some stores"),
        errors: expect.arrayContaining([expect.any(String)]),
        postgresDeleted: true,
        qdrantDeleted: false,
      });
    });
  });

  describe("Document ID Validation", () => {
    it("should handle various UUID formats", async () => {
      const validUuids = [
        "550e8400-e29b-41d4-a716-446655440000",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      ];

      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteDocumentQdrant").mockResolvedValue(undefined);

      for (const uuid of validUuids) {
        const response = await app.inject({
          method: "DELETE",
          url: `/api/documents/${uuid}`,
        });

        expect(response.statusCode).toBe(200);
      }
    });

    it("should pass through any document ID to deletion functions", async () => {
      const documentId = "custom-id-123";

      const deleteDocSpy = vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      const deleteQdrantSpy = vi.spyOn(qdrant, "deleteDocumentQdrant").mockResolvedValue(undefined);

      await app.inject({
        method: "DELETE",
        url: `/api/documents/${documentId}`,
      });

      expect(deleteDocSpy).toHaveBeenCalledWith(documentId);
      expect(deleteQdrantSpy).toHaveBeenCalledWith(documentId);
    });
  });
});
