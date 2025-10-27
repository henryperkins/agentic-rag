import { describe, it, expect } from "vitest";
import { chunkText } from "../src/services/documents";

describe("chunkText", () => {
  it("creates overlapping chunks deterministically", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const chunks = chunkText(text, 10, 2);
    // Expect 3 chunks: [0..9], [8..17], [16..25]
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe("abcdefghij");
    expect(chunks[1]).toBe("ijklmnopqr");
    expect(chunks[2]).toBe("qrstuvwxyz");
  });

  it("returns full text when below chunk size", () => {
    const text = "short";
    const chunks = chunkText(text, 100, 10);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe("short");
  });
});
