import { describe, it, expect, vi } from "vitest";
import { runCoordinator } from "../src/services/orchestration/coordinator";
import { SSEOutEvent } from "../../shared/types";
import { MOCK_OPENAI } from "../src/config/constants";

describe("Shadow Tests", () => {
  if (MOCK_OPENAI) {
    it.skip("Skipping shadow tests because MOCK_OPENAI is enabled", () => {});
    return;
  }

  it("should run a simple query against the real OpenAI models", async () => {
    const events: SSEOutEvent[] = [];
    const sender = (e: SSEOutEvent) => events.push(e);

    await runCoordinator("What is the capital of France?", sender, {
      useRag: false,
      useHybrid: false,
      useWeb: true,
    });

    const finalText = events
      .filter((e) => e.type === "final")
      .map((e: any) => e.text)
      .join("");

    expect(finalText).toContain("Paris");
  }, 30000);
});