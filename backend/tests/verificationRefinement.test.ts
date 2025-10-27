import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCoordinator } from "../src/services/orchestration/coordinator";
import * as verifier from "../src/services/verifier";
import * as registry from "../src/services/orchestration/registry";
import { SSEOutEvent } from "../../shared/types";

vi.mock("../src/services/verifier");
vi.mock("../src/services/orchestration/registry");

describe("Verification Loop Refinement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should rewrite query on verification failure with low confidence", async () => {
    const mockVerifyAnswer = vi.spyOn(verifier, "verifyAnswer").mockResolvedValue({ isValid: false, confidence: 0.4, feedback: "Low confidence" });
    const mockRewriteQuery = vi.spyOn(registry.Agents.quality, "rewriteQuery").mockResolvedValue("rewritten query");

    const events: SSEOutEvent[] = [];
    const sender = (e: SSEOutEvent) => events.push(e);

    await runCoordinator("original query", sender, { useRag: true, useHybrid: true, useWeb: false });

    expect(mockVerifyAnswer).toHaveBeenCalled();
    expect(mockRewriteQuery).toHaveBeenCalledWith("original query");
    expect(events.some((e) => e.type === "rewrite")).toBe(true);
  });

  it("should not rewrite query on verification failure with high confidence", async () => {
    const mockVerifyAnswer = vi.spyOn(verifier, "verifyAnswer").mockResolvedValue({ isValid: false, confidence: 0.6, feedback: "High confidence" });
    const mockRewriteQuery = vi.spyOn(registry.Agents.quality, "rewriteQuery");

    const events: SSEOutEvent[] = [];
    const sender = (e: SSEOutEvent) => events.push(e);

    await runCoordinator("original query", sender, { useRag: true, useHybrid: true, useWeb: false });

    expect(mockVerifyAnswer).toHaveBeenCalled();
    expect(mockRewriteQuery).not.toHaveBeenCalled();
  });
});