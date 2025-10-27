import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    setupFiles: [],
    env: {
      MOCK_OPENAI: "1",
      EMBEDDING_DIMENSIONS: "1536",
      HYBRID_VECTOR_WEIGHT: "0.7",
      HYBRID_KEYWORD_WEIGHT: "0.3",
      RAG_TOP_K: "5",
      MAX_AGENT_STEPS: "3",
      MAX_VERIFICATION_LOOPS: "2"
    }
  }
});
