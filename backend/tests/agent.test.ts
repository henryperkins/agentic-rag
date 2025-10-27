import { describe, it, expect } from "vitest";
import { runCoordinator } from "../src/services/orchestration/coordinator";

describe("coordinator direct mode", () => {
  it("completes when RAG disabled", async () => {
    const events: any[] = [];
    const sender = (e: any) => events.push(e);
    await runCoordinator("What can you do?", sender, { useRag: false, useHybrid: true, useWeb: false });
    // Should emit final event
    expect(events.some((e) => e.type === "final")).toBe(true);
  });
});
