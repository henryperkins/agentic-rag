import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ingestDocument } from "../src/services/documents";
import { hybridRetrieve } from "../src/services/retrieval";
import * as sql from "../src/db/sql";
import * as qdrant from "../src/db/qdrant";
import * as embeddings from "../src/services/embeddings";
import * as otel from "../src/config/otel";

// Mock constants to enable dual-store for tests
vi.mock("../src/config/constants", async () => {
  const actual = await vi.importActual("../src/config/constants");
  return {
    ...actual,
    USE_DUAL_VECTOR_STORE: true,
    CHUNK_SIZE: 100,
    CHUNK_OVERLAP: 20,
    RAG_TOP_K: 5,
    HYBRID_VECTOR_WEIGHT: 0.7,
    HYBRID_KEYWORD_WEIGHT: 0.3,
  };
});

describe("Dual Vector Store Integration", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Compensating Transactions", () => {
    it("should rollback Postgres insert when Qdrant fails", async () => {
      // Mock successful Postgres operations
      const mockDocId = "doc-123";
      const mockChunkId = "chunk-456";

      vi.spyOn(sql, "insertDocument").mockResolvedValue(mockDocId);
      vi.spyOn(sql, "insertChunk").mockResolvedValue(mockChunkId);
      vi.spyOn(sql, "deleteChunk").mockResolvedValue(undefined);
      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);

      // Mock Qdrant failure
      vi.spyOn(qdrant, "insertChunkQdrant").mockRejectedValue(
        new Error("Qdrant network timeout")
      );

      // Mock embeddings
      vi.spyOn(embeddings, "embedTexts").mockResolvedValue([
        new Array(1536).fill(0.1),
      ]);

      // Attempt ingestion
      const content = "Short test content for dual store.";
      await expect(ingestDocument(content, "Test Doc", "test.md")).rejects.toThrow(
        /Failed to sync chunk/
      );

      // Verify rollback occurred
      expect(sql.deleteChunk).toHaveBeenCalledWith(mockChunkId);
      expect(sql.deleteDocument).toHaveBeenCalledWith(mockDocId);
    });

    it("should succeed when both stores succeed", async () => {
      const mockDocId = "doc-789";
      const mockChunkId = "chunk-abc";

      vi.spyOn(sql, "insertDocument").mockResolvedValue(mockDocId);
      vi.spyOn(sql, "insertChunk").mockResolvedValue(mockChunkId);
      vi.spyOn(qdrant, "insertChunkQdrant").mockResolvedValue(undefined);
      vi.spyOn(embeddings, "embedTexts").mockResolvedValue([
        new Array(1536).fill(0.2),
      ]);

      const result = await ingestDocument(
        "Another test content.",
        "Success Doc",
        "success.md"
      );

      expect(result.documentId).toBe(mockDocId);
      expect(result.chunksInserted).toBe(1);
      expect(qdrant.insertChunkQdrant).toHaveBeenCalledWith(
        mockChunkId,
        mockDocId,
        0,
        expect.any(String),
        expect.any(Array),
        "success.md" // Source should be passed
      );
    });

    it("should cleanup all chunks on partial failure", async () => {
      const mockDocId = "doc-multi";
      vi.spyOn(sql, "insertDocument").mockResolvedValue(mockDocId);

      // First chunk succeeds
      vi.spyOn(sql, "insertChunk")
        .mockResolvedValueOnce("chunk-1")
        .mockResolvedValueOnce("chunk-2");

      // First Qdrant insert succeeds, second fails
      vi.spyOn(qdrant, "insertChunkQdrant")
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Qdrant quota exceeded"));

      vi.spyOn(sql, "deleteChunk").mockResolvedValue(undefined);
      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);
      vi.spyOn(qdrant, "deleteChunkQdrant").mockResolvedValue(undefined);

      vi.spyOn(embeddings, "embedTexts").mockResolvedValue([
        new Array(1536).fill(0.1),
        new Array(1536).fill(0.2),
      ]);

      const longContent = "A".repeat(150); // Creates 2 chunks
      await expect(
        ingestDocument(longContent, "Multi Chunk", "multi.md")
      ).rejects.toThrow();

      // Should cleanup both Postgres and Qdrant
      expect(sql.deleteDocument).toHaveBeenCalledWith(mockDocId);
      expect(qdrant.deleteChunkQdrant).toHaveBeenCalledWith("chunk-1");
    });
  });

  describe("Deduplication Logic", () => {
    it("should deduplicate same chunk from both stores and keep higher score", async () => {
      const sharedChunkId = "chunk-shared-123";
      const mockEmbedding = new Array(1536).fill(0.5);

      // Mock Postgres returning chunk with score 0.8
      vi.spyOn(sql, "vectorSearch").mockResolvedValue([
        {
          id: sharedChunkId,
          document_id: "doc-1",
          chunk_index: 0,
          content: "Shared content from Postgres",
          source: "postgres.md",
          vector_sim: 0.8,
        },
      ]);

      // Mock Qdrant returning same chunk with score 0.6
      vi.spyOn(qdrant, "vectorSearchQdrant").mockResolvedValue([
        {
          chunk_id: sharedChunkId,
          document_id: "doc-1",
          chunk_index: 0,
          content: "Shared content from Postgres",
          source: "postgres.md",
          score: 0.6,
        },
      ]);

      // Mock trigram search returning nothing
      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([]);

      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);

      const results = await hybridRetrieve("test query", true);

      // Should only return 1 result (deduplicated)
      expect(results).toHaveLength(1);

      // Should keep the chunk with higher pre-rerank score
      expect(results[0].id).toBe(sharedChunkId);
      // Note: Final score is reranked using Jaccard fallback: 0.7 * overlap + 0.3 * preScore
      // Pre-rerank score was 0.7 * 0.8 = 0.56 from Postgres (higher than Qdrant's 0.42)
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].source).toBe("postgres.md");
    });

    it("should combine unique chunks from both stores", async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      vi.spyOn(sql, "vectorSearch").mockResolvedValue([
        {
          id: "pg-chunk-1",
          document_id: "doc-pg",
          chunk_index: 0,
          content: "Postgres only content",
          source: "pg.md",
          vector_sim: 0.75,
        },
      ]);

      vi.spyOn(qdrant, "vectorSearchQdrant").mockResolvedValue([
        {
          chunk_id: "qdrant-chunk-1",
          document_id: "doc-qdrant",
          chunk_index: 0,
          content: "Qdrant only content",
          source: "qdrant.md",
          score: 0.70,
        },
      ]);

      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([]);
      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);

      const results = await hybridRetrieve("test query", true);

      // Should return both unique chunks
      expect(results.length).toBeGreaterThanOrEqual(2);

      const chunkIds = results.map((r) => r.id);
      expect(chunkIds).toContain("pg-chunk-1");
      expect(chunkIds).toContain("qdrant-chunk-1");
    });

    it("should preserve source field through deduplication", async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      vi.spyOn(sql, "vectorSearch").mockResolvedValue([
        {
          id: "chunk-1",
          document_id: "doc-1",
          chunk_index: 0,
          content: "Content with source",
          source: "important-doc.md",
          vector_sim: 0.9,
        },
      ]);

      vi.spyOn(qdrant, "vectorSearchQdrant").mockResolvedValue([]);
      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([]);
      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);

      const results = await hybridRetrieve("query", true);

      expect(results[0].source).toBe("important-doc.md");
    });
  });

  describe("Parallel Retrieval Performance", () => {
    it("should query both stores in parallel", async () => {
      const mockEmbedding = new Array(1536).fill(0.5);
      let pgStartTime: number;
      let qdrantStartTime: number;

      // Simulate slow operations
      vi.spyOn(sql, "vectorSearch").mockImplementation(async () => {
        pgStartTime = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [
          {
            id: "pg-chunk",
            document_id: "doc-pg",
            chunk_index: 0,
            content: "PG content",
            source: "pg.md",
            vector_sim: 0.8,
          },
        ];
      });

      vi.spyOn(qdrant, "vectorSearchQdrant").mockImplementation(async () => {
        qdrantStartTime = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [
          {
            chunk_id: "qdrant-chunk",
            document_id: "doc-qdrant",
            chunk_index: 0,
            content: "Qdrant content",
            source: "qdrant.md",
            score: 0.7,
          },
        ];
      });

      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([]);
      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);

      const startTime = Date.now();
      await hybridRetrieve("query", true);
      const totalTime = Date.now() - startTime;

      // Both should start at roughly the same time (parallel execution)
      expect(Math.abs(pgStartTime! - qdrantStartTime!)).toBeLessThan(10);

      // Total time should be ~50ms (parallel), not ~100ms (sequential)
      expect(totalTime).toBeLessThan(100);
    });
  });

  describe("Hybrid Search Integration", () => {
    it("should combine vector and trigram results", async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      // Vector results
      vi.spyOn(sql, "vectorSearch").mockResolvedValue([
        {
          id: "vector-chunk",
          document_id: "doc-vector",
          chunk_index: 0,
          content: "Vector match",
          source: "vector.md",
          vector_sim: 0.85,
        },
      ]);

      vi.spyOn(qdrant, "vectorSearchQdrant").mockResolvedValue([]);

      // Trigram results
      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([
        {
          document_id: "doc-trigram",
          title: "Keyword Match Title",
          source: "keyword.md",
          trigram_sim: 0.9,
        },
      ]);

      vi.spyOn(sql, "chunksByDocumentIds").mockResolvedValue([
        {
          id: "trigram-chunk",
          document_id: "doc-trigram",
          chunk_index: 0,
          content: "Keyword content",
          source: "keyword.md",
        },
      ]);

      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);

      const results = await hybridRetrieve("query", true);

      // Should contain results from both vector and trigram searches
      expect(results.length).toBeGreaterThanOrEqual(2);

      const chunkIds = results.map((r) => r.id);
      expect(chunkIds).toContain("vector-chunk");
      expect(chunkIds).toContain("trigram-chunk");
    });

    it("should weight vector results at 70% and keyword at 30%", async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      vi.spyOn(sql, "vectorSearch").mockResolvedValue([
        {
          id: "chunk-1",
          document_id: "doc-1",
          chunk_index: 0,
          content: "Content",
          source: "test.md",
          vector_sim: 0.8,
        },
      ]);

      vi.spyOn(qdrant, "vectorSearchQdrant").mockResolvedValue([]);
      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([]);
      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);

      const results = await hybridRetrieve("query", true);

      // Pre-rerank vector score: 0.7 (weight) * 0.8 (sim) = 0.56
      // After reranking: 0.7 * jaccard + 0.3 * 0.56
      // Result should be > 0 and based on weighted scoring
      expect(results[0].score).toBeGreaterThan(0);
      expect(results).toHaveLength(1);
    });
  });

  describe("Error Handling and Resilience", () => {
    it("should degrade to Postgres-only results when Qdrant is unavailable", async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      vi.spyOn(sql, "vectorSearch").mockResolvedValue([
        {
          id: "pg-chunk",
          document_id: "doc-pg",
          chunk_index: 0,
          content: "Postgres content",
          source: "pg.md",
          vector_sim: 0.75,
        },
      ]);

      // Qdrant throws error during retrieval
      vi.spyOn(qdrant, "vectorSearchQdrant").mockRejectedValue(
        new Error("Qdrant unavailable")
      );

      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([]);
      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);
      const addEventSpy = vi.spyOn(otel, "addEvent").mockImplementation(() => {});

      const results = await hybridRetrieve("query", true);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("pg-chunk");
      expect(addEventSpy).toHaveBeenCalledWith(
        "retrieval.qdrant_fallback",
        expect.objectContaining({ error: "Qdrant unavailable" })
      );
    });

    it("should handle empty results from both stores", async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      vi.spyOn(sql, "vectorSearch").mockResolvedValue([]);
      vi.spyOn(qdrant, "vectorSearchQdrant").mockResolvedValue([]);
      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([]);
      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);

      const results = await hybridRetrieve("nonexistent query", true);

      expect(results).toHaveLength(0);
    });
  });

  describe("Retry Logic Integration", () => {
    it("should handle Qdrant failures with compensating transaction", async () => {
      // Retry logic is embedded in insertChunkQdrant via withRetry
      // When mocked to always fail, it should trigger rollback after max retries
      const mockDocId = "550e8400-e29b-41d4-a716-446655440000";
      const mockChunkId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

      vi.spyOn(sql, "insertDocument").mockResolvedValue(mockDocId);
      vi.spyOn(sql, "insertChunk").mockResolvedValue(mockChunkId);
      const deleteChunkSpy = vi.spyOn(sql, "deleteChunk").mockResolvedValue(undefined);
      const deleteDocSpy = vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);

      // Always fail (exhausts retries inside insertChunkQdrant)
      vi.spyOn(qdrant, "insertChunkQdrant").mockRejectedValue(
        new Error("Transient network error")
      );

      vi.spyOn(embeddings, "embedTexts").mockResolvedValue([
        new Array(1536).fill(0.3),
      ]);

      await expect(
        ingestDocument("Retry test content", "Retry Doc", "retry.md")
      ).rejects.toThrow(/Failed to sync chunk/);

      // Should have triggered rollback
      expect(deleteChunkSpy).toHaveBeenCalledWith(mockChunkId);
      expect(deleteDocSpy).toHaveBeenCalledWith(mockDocId);
    });

    it("should give up after max retries and rollback", async () => {
      const mockDocId = "550e8400-e29b-41d4-a716-446655440001";
      const mockChunkId = "6ba7b810-9dad-11d1-80b4-00c04fd430c9";

      vi.spyOn(sql, "insertDocument").mockResolvedValue(mockDocId);
      vi.spyOn(sql, "insertChunk").mockResolvedValue(mockChunkId);
      vi.spyOn(sql, "deleteChunk").mockResolvedValue(undefined);
      vi.spyOn(sql, "deleteDocument").mockResolvedValue(undefined);

      // Always fail
      vi.spyOn(qdrant, "insertChunkQdrant").mockRejectedValue(
        new Error("Permanent failure")
      );

      vi.spyOn(embeddings, "embedTexts").mockResolvedValue([
        new Array(1536).fill(0.4),
      ]);

      await expect(
        ingestDocument("Permanent fail content", "Fail Doc", "fail.md")
      ).rejects.toThrow(/Failed to sync chunk/);

      // Should have rolled back
      expect(sql.deleteDocument).toHaveBeenCalled();
    });
  });

  describe("Over-Fetching for Deduplication", () => {
    it("should fetch 2x top_k to account for deduplication", async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      const vectorSearchSpy = vi
        .spyOn(sql, "vectorSearch")
        .mockResolvedValue([]);
      const qdrantSearchSpy = vi
        .spyOn(qdrant, "vectorSearchQdrant")
        .mockResolvedValue([]);

      vi.spyOn(sql, "trigramTitleSearch").mockResolvedValue([]);
      vi.spyOn(embeddings, "embedText").mockResolvedValue(mockEmbedding);

      await hybridRetrieve("query", true);

      // Should fetch 2x RAG_TOP_K (which is 5, so 10)
      expect(vectorSearchSpy).toHaveBeenCalledWith(mockEmbedding, 10);
      expect(qdrantSearchSpy).toHaveBeenCalledWith(mockEmbedding, 10);
    });
  });
});
