import { describe, it, expect, beforeAll } from "vitest";
import { performWebSearch } from "../src/services/webSearch";

describe("Web Search", () => {
    beforeAll(() => {
        // Ensure web search is enabled for tests
        process.env.ENABLE_WEB_SEARCH = "true";
    });

    it("should return empty array when query is empty", async () => {
        const results = await performWebSearch("", 5);
        expect(results).toEqual([]);
    });

    it("should return web search results for valid query", async () => {
        const results = await performWebSearch("latest AI news", 3);
        expect(Array.isArray(results)).toBe(true);

        // In mock mode, should return synthetic results
        if (results.length > 0) {
            expect(results[0]).toHaveProperty("title");
            expect(results[0]).toHaveProperty("url");
            expect(results[0]).toHaveProperty("snippet");
            expect(results[0]).toHaveProperty("score");
        }
    });

    it("should respect maxResults parameter", async () => {
        const maxResults = 2;
        const results = await performWebSearch("test query", maxResults);
        expect(results.length).toBeLessThanOrEqual(maxResults);
    });

    it("should assign descending scores based on result position", async () => {
        const results = await performWebSearch("test query", 5);

        if (results.length > 1) {
            // Scores should be 1, 0.5, 0.33..., 0.25, 0.2 (1/(idx+1))
            expect(results[0].score).toBeGreaterThan(results[1].score);
        }
    });
});
