import { describe, it, expect, beforeAll } from "vitest";
import { classifyQuery, classifyQueryHeuristic } from "../src/services/orchestration/classifier";

describe("Query Classifier", () => {
  // Default options for tests
  const defaultOpts = { useRag: true, useWeb: true };

  beforeAll(() => {
    // Ensure we're in test mode
    process.env.MOCK_OPENAI = "1";
  });

  describe("Heuristic Classifier", () => {
    it("should classify simple queries as direct mode", () => {
      const result = classifyQueryHeuristic("hello", defaultOpts);
      expect(result.mode).toBe("direct");
      expect(result.complexity).toBe("low");
      expect(result.targets).toContain("vector");
    });

    it("should classify longer queries as retrieve mode", () => {
      const result = classifyQueryHeuristic("What is the difference between pgvector and traditional search?", defaultOpts);
      expect(result.mode).toBe("retrieve");
      expect(result.complexity).toBe("medium");
      expect(result.targets).toContain("vector");
    });

    it("should detect SQL indicators", () => {
      const result = classifyQueryHeuristic("SELECT count from documents WHERE title contains AI", defaultOpts);
      expect(result.targets).toContain("sql");
      expect(result.targets).toContain("vector");
    });

    it("should detect recency indicators", () => {
      const result = classifyQueryHeuristic("What are the latest AI updates in 2025?", defaultOpts);
      expect(result.targets).toContain("web");
      expect(result.targets).toContain("vector");
    });

    it("should classify complex analytical queries as high complexity", () => {
      const result = classifyQueryHeuristic(
        "How do aggregation pipelines compare to traditional joins in terms of performance and scalability across different systems?",
        defaultOpts
      );
      expect(result.complexity).toBe("high");
      expect(result.mode).toBe("retrieve");
    });

    it("should handle queries with multiple indicators", () => {
      const result = classifyQueryHeuristic(
        "Show me the latest database tables with count aggregations from recent updates",
        defaultOpts
      );
      expect(result.targets).toContain("vector");
      expect(result.targets).toContain("sql");
      expect(result.targets).toContain("web");
    });

    it("should deduplicate targets", () => {
      const result = classifyQueryHeuristic("latest today current news update recent", defaultOpts);
      // All these are recency indicators, should only have one "web" target
      const webCount = result.targets.filter(t => t === "web").length;
      expect(webCount).toBe(1);
    });
  });

  describe("LLM Classifier", () => {
    it("should classify queries when LLM mode is disabled", async () => {
      process.env.USE_LLM_CLASSIFIER = "false";
      const result = await classifyQuery("What is vector search?", defaultOpts);
      expect(result).toHaveProperty("mode");
      expect(result).toHaveProperty("complexity");
      expect(result).toHaveProperty("targets");
      expect(Array.isArray(result.targets)).toBe(true);
    });

    it("should handle LLM classification with mock", async () => {
      process.env.USE_LLM_CLASSIFIER = "true";
      const result = await classifyQuery("What are the latest trends in RAG systems?", defaultOpts);

      // In mock mode or with fallback, should still return valid structure
      expect(result).toHaveProperty("mode");
      expect(["retrieve", "direct"]).toContain(result.mode);
      expect(["low", "medium", "high"]).toContain(result.complexity);
      expect(Array.isArray(result.targets)).toBe(true);
      expect(result.targets.length).toBeGreaterThan(0);
    });

    it("should fallback to heuristics on LLM failure", async () => {
      process.env.USE_LLM_CLASSIFIER = "true";

      // This should trigger fallback in mock mode
      const result = await classifyQuery("test query for fallback", defaultOpts);

      expect(result).toHaveProperty("mode");
      expect(result).toHaveProperty("complexity");
      expect(result.targets).toContain("vector");
    });

    it("should handle greetings appropriately", async () => {
      process.env.USE_LLM_CLASSIFIER = "false";
      const result = await classifyQuery("Hi", defaultOpts);
      expect(result.mode).toBe("direct");
      expect(result.complexity).toBe("low");
    });

    it("should identify database queries", async () => {
      process.env.USE_LLM_CLASSIFIER = "false";
      const result = await classifyQuery("How many documents are in the chunks table?", defaultOpts);
      expect(result.targets).toContain("sql");
    });

    it("should identify time-sensitive queries", async () => {
      process.env.USE_LLM_CLASSIFIER = "false";
      const result = await classifyQuery("What happened yesterday in AI news?", defaultOpts);
      expect(result.targets).toContain("web");
    });
  });

  describe("Target Selection", () => {
    it("should always include vector by default", () => {
      const result = classifyQueryHeuristic("random query", defaultOpts);
      expect(result.targets).toContain("vector");
    });

    it("should add sql for SQL keywords", () => {
      const queries = [
        "SELECT count from documents",
        "show me the table with chunks",
        "WHERE column has values",
        "GROUP BY document type"
      ];

      queries.forEach(query => {
        const result = classifyQueryHeuristic(query, defaultOpts);
        expect(result.targets).toContain("sql");
      });
    });

    it("should add web for temporal queries", () => {
      const queries = [
        "news today",
        "current status",
        "recent updates",
        "what happened yesterday"
      ];

      queries.forEach(query => {
        const result = classifyQueryHeuristic(query, defaultOpts);
        expect(result.targets).toContain("web");
      });
    });

    it("should handle year-specific queries", () => {
      const result = classifyQueryHeuristic("What were the AI breakthroughs in 2024?", defaultOpts);
      expect(result.targets).toContain("web");
    });
  });

  describe("Complexity Assessment", () => {
    it("should rate short simple queries as low complexity", () => {
      const result = classifyQueryHeuristic("what is AI", defaultOpts);
      expect(result.complexity).toBe("low");
    });

    it("should rate medium-length queries as medium complexity", () => {
      const result = classifyQueryHeuristic("explain how vector databases work", defaultOpts);
      expect(result.complexity).toBe("medium");
    });

    it("should rate queries with operators as medium or high", () => {
      const result = classifyQueryHeuristic("compare vector search to keyword search", defaultOpts);
      expect(["medium", "high"]).toContain(result.complexity);
    });

    it("should rate long analytical queries as high complexity", () => {
      const result = classifyQueryHeuristic(
        "How do hybrid search systems compare aggregation pipelines with traditional SQL joins in distributed database environments?",
        defaultOpts
      );
      expect(result.complexity).toBe("high");
    });
  });

  describe("Mode Selection", () => {
    it("should use direct mode for very short queries", () => {
      const result = classifyQueryHeuristic("hi", defaultOpts);
      expect(result.mode).toBe("direct");
    });

    it("should use retrieve mode for knowledge queries", () => {
      const result = classifyQueryHeuristic("How do vector embeddings work in modern systems?", defaultOpts);
      expect(result.mode).toBe("retrieve");
    });

    it("should use retrieve mode for queries with operators", () => {
      const operators = ["why", "how", "compare", "aggregate", "join"];

      operators.forEach(op => {
        const result = classifyQueryHeuristic(`${op} does this work`, defaultOpts);
        expect(result.mode).toBe("retrieve");
      });
    });
  });
});
