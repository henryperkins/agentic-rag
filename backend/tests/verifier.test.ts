import { describe, it, expect } from "vitest";
import { gradeChunks, verifyAnswer } from "../src/services/verifier";

describe("verifier", () => {
  it("grades shape and values", () => {
    const q = "hybrid retrieval with citations";
    const chunks = [
      { id: "1", content: "Hybrid retrieval combines vector search and keyword signals with citations." },
      { id: "2", content: "A story about a cat and a dog." }
    ];
    const grades = gradeChunks(q, chunks);
    expect(Object.keys(grades)).toHaveLength(2);
    expect(["high", "medium", "low"]).toContain(grades["1"]);
    expect(["high", "medium", "low"]).toContain(grades["2"]);
  });

  it("verifies support", () => {
    const ans = "Hybrid retrieval combines vector search and keyword signals with citations.";
    const ev = [{ id: "e1", content: ans }];
    const res = verifyAnswer(ans, ev);
    expect(res.isValid).toBe(true);
  });
});
