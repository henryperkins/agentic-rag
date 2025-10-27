import { describe, it, expect } from "vitest";
import { rerank } from "../src/services/reranker";

describe("reranker fallback", () => {
  it("improves ordering based on overlap", async () => {
    const query = "pgvector similarity search embeddings";
    const candidates = [
      {
        id: "a",
        document_id: "d1",
        chunk_index: 0,
        content: "This chunk talks about cooking pasta and tomato sauce.",
        preScore: 0.8
      },
      {
        id: "b",
        document_id: "d2",
        chunk_index: 1,
        content: "pgvector enables similarity search on embeddings within PostgreSQL.",
        preScore: 0.2
      }
    ];
    const ranked = await rerank(query, candidates);
    expect(ranked[0].id).toBe("b"); // should be promoted due to topical overlap
  });
});
