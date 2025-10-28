import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCoordinator } from "../src/services/orchestration/coordinator";
import { responseCache } from "../src/services/cache";
import { Agents } from "../src/services/orchestration/registry";
import { FinalEvent } from "../../shared/types";
import * as classifier from "../src/services/orchestration/classifier";
import * as verifier from "../src/services/verifier";

vi.mock("../src/services/orchestration/classifier");
vi.mock("../src/services/verifier");

describe("Coordinator Integration Tests", () => {
  beforeEach(() => {
    responseCache.clear();
    vi.resetAllMocks();
  });

  it("should cache the full FinalEvent payload and replay it correctly", async () => {
    const sender = vi.fn();
    const message = "test message";

    vi.mocked(classifier.classifyQuery).mockResolvedValue({
      mode: "retrieve",
      complexity: "low",
      targets: ["vector"],
    });
    vi.mocked(verifier.gradeChunksWithScores).mockResolvedValue({ grades: {}, metadata: { scores: {}, method: "mock" } });
    vi.mocked(verifier.verifyAnswer).mockReturnValue({ isValid: false, confidence: 0.1, feedback: "failed" });
    vi.spyOn(Agents.retrieval, "hybridRetrieve").mockResolvedValue([]);

    // First run to populate the cache
    await runCoordinator(message, sender, { useRag: true, useHybrid: false, useWeb: false });

    // Second run should hit the cache
    await runCoordinator(message, sender, { useRag: true, useHybrid: false, useWeb: false });

    // Check that the sender was called with the cached event
    const finalEventMatcher = expect.objectContaining({
      type: "final",
      text: expect.any(String),
      verified: false,
    });

    expect(sender).toHaveBeenCalledWith(finalEventMatcher);
  });

  it("should handle web search errors gracefully and fall back", async () => {
    const sender = vi.fn();
    const message = "test web search";

    vi.mocked(classifier.classifyQuery).mockResolvedValue({
      mode: "retrieve",
      complexity: "low",
      targets: ["vector", "web"],
    });
    vi.mocked(verifier.gradeChunksWithScores).mockResolvedValue({ grades: { "1": "high" }, metadata: { scores: { "1": 0.9 }, method: "mock" } });
    vi.mocked(verifier.verifyAnswer).mockReturnValue({ isValid: true, confidence: 0.9, feedback: "ok" });
    vi.spyOn(Agents.retrieval, "webRetrieveWithMetadataStream").mockRejectedValue(new Error("Web search failed"));
    vi.spyOn(Agents.retrieval, "hybridRetrieve").mockResolvedValue([{ id: "1", content: "fallback content", document_id: "doc1", source: "s1", chunk_index: 0 }]);

    await runCoordinator(message, sender, { useRag: true, useHybrid: false, useWeb: true });

    // Check that an agent log was sent with the error and a final event was still sent
    const agentLogMatcher = expect.objectContaining({
      type: "agent_log",
      message: expect.stringContaining("Web search failed"),
    });

    const finalEventMatcher = expect.objectContaining({
      type: "final",
      verified: true,
    });

    expect(sender).toHaveBeenCalledWith(agentLogMatcher);
    expect(sender).toHaveBeenCalledWith(finalEventMatcher);
  });
});