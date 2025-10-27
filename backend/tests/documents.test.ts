import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "../src/server";
import { insertDocument, insertChunk, deleteDocument } from "../src/db/sql";
import { EMBEDDING_DIMENSIONS } from "../src/config/constants";
import { FastifyInstance } from "fastify";

describe("Document Routes", () => {
  let app: FastifyInstance;
  let documentId: string;

  beforeAll(async () => {
    app = await build();
    documentId = await insertDocument("Test Title", "test-source");
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
    await insertChunk(documentId, 0, "Test content chunk 0", embedding);
    await insertChunk(documentId, 1, "Test content chunk 1", embedding);
  });

  afterAll(async () => {
    await deleteDocument(documentId);
    await app.close();
  });

  it("should return a document with its chunks", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/documents/${documentId}/full`,
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.id).toBe(documentId);
    expect(payload.chunks).toBeDefined();
    expect(payload.chunks).toHaveLength(2);
    expect(payload.chunks[0].chunk_index).toBe(0);
    expect(payload.chunks[0].content).toBe("Test content chunk 0");
    expect(payload.chunks[1].chunk_index).toBe(1);
    expect(payload.chunks[1].content).toBe("Test content chunk 1");
  });

  it("should return 404 for a non-existent document", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/documents/non-existent-id/full",
    });

    expect(response.statusCode).toBe(404);
  });
});