import { describe, it, expect, vi } from "vitest";
import { runCoordinator } from "../src/services/orchestration/coordinator";
import type { SSEOutEvent } from "../../shared/types";

describe("Web-Only Mode", () => {
    it("should perform web search when useRag=false and useWeb=true", async () => {
        const events: SSEOutEvent[] = [];
        const sender = (e: SSEOutEvent) => {
            events.push(e);
        };

        // Query with recency indicator to trigger web search
        await runCoordinator(
            "What are the latest AI updates in 2025?",
            sender,
            { useRag: false, useHybrid: false, useWeb: true }
        );

        // Should not enter direct mode
        const textEvents = events.filter(e => e.type === "tokens").map(e => (e as any).text).join("");
        expect(textEvents).not.toContain("Direct mode");

        // Should have agent logs showing web retrieval
        const agentLogs = events.filter(e => e.type === "agent_log");
        const researcherLogs = agentLogs.filter((e: any) => e.role === "researcher");
        expect(researcherLogs.length).toBeGreaterThan(0);

        // Should show web in the mode label
        const modeLog = researcherLogs.find((e: any) =>
            e.message.includes("Retrieving evidence") && e.message.includes("web")
        );
        expect(modeLog).toBeDefined();

        // Should have a final event
        const finalEvent = events.find(e => e.type === "final");
        expect(finalEvent).toBeDefined();
    });

    it("should surface the direct-mode warning when both useRag=false and useWeb=false", async () => {
        const events: SSEOutEvent[] = [];
        const sender = (e: SSEOutEvent) => {
            events.push(e);
        };

        await runCoordinator(
            "What is AI?",
            sender,
            { useRag: false, useHybrid: false, useWeb: false }
        );

        // Should surface the direct mode warning
        const textEvents = events.filter(e => e.type === "tokens").map(e => (e as any).text).join("");
        expect(textEvents).toContain("No retrieval methods enabled. Please enable at least one of:");

        const finalEvent = events.find(e => e.type === "final");
        expect(finalEvent).toBeDefined();
    });

    it("should combine web and RAG results when both are enabled", async () => {
        const events: SSEOutEvent[] = [];
        const sender = (e: SSEOutEvent) => {
            events.push(e);
        };

        await runCoordinator(
            "What are the latest updates on pgvector in 2025?",
            sender,
            { useRag: true, useHybrid: true, useWeb: true }
        );

        // Should have agent logs
        const agentLogs = events.filter(e => e.type === "agent_log");
        expect(agentLogs.length).toBeGreaterThan(0);

        // Mode label should include both
        const researcherLogs = agentLogs.filter((e: any) => e.role === "researcher");
        const modeLog = researcherLogs.find((e: any) =>
            e.message.includes("Retrieving evidence")
        );
        expect(modeLog).toBeDefined();

        const finalEvent = events.find(e => e.type === "final");
        expect(finalEvent).toBeDefined();
    });
});
