import { describe, it, expect, beforeAll } from "vitest";
import { performWebSearch } from "../src/services/webSearch";

describe("Web Search", () => {
    beforeAll(() => {
        // Ensure web search is enabled for tests
        process.env.ENABLE_WEB_SEARCH = "true";
    });

    it("should return empty chunks array when query is empty", async () => {
        const response = await performWebSearch("", 5);
        expect(response.chunks).toEqual([]);
        expect(response.metadata).toBeDefined();
    });

    it("should return web search results with metadata for valid query", async () => {
        const response = await performWebSearch("latest AI news", 3);
        expect(Array.isArray(response.chunks)).toBe(true);
        expect(response.metadata).toBeDefined();

        // In mock mode, should return synthetic results
        if (response.chunks.length > 0) {
            expect(response.chunks[0]).toHaveProperty("title");
            expect(response.chunks[0]).toHaveProperty("url");
            expect(response.chunks[0]).toHaveProperty("snippet");
            expect(response.chunks[0]).toHaveProperty("score");
            expect(response.chunks[0]).toHaveProperty("relevance");
        }

        // Metadata should include search info
        if (response.chunks.length > 0) {
            expect(response.metadata).toHaveProperty("searchQuery");
            expect(response.metadata).toHaveProperty("allSources");
        }
    });

    it("should respect maxResults parameter", async () => {
        const maxResults = 2;
        const response = await performWebSearch("test query", maxResults);
        expect(response.chunks.length).toBeLessThanOrEqual(maxResults);
    });

    it("should assign descending scores based on result position", async () => {
        const response = await performWebSearch("test query", 5);

        if (response.chunks.length > 1) {
            // Scores should descend (relevance is 1/(idx+1))
            expect(response.chunks[0].score).toBeGreaterThanOrEqual(response.chunks[1].score);
        }
    });

    it("should support domain filtering", async () => {
        const allowedDomains = ["example.com", "test.com"];
        const response = await performWebSearch("test query", 5, allowedDomains);

        expect(response.chunks).toBeDefined();
        expect(response.metadata).toBeDefined();

        // In mock mode, metadata should reflect allowed domains
        if (response.metadata.domainsSearched) {
            expect(response.metadata.domainsSearched).toEqual(allowedDomains);
        }
    });
});
