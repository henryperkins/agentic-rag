import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { healthRoutes } from "../src/routes/health";
import * as qdrant from "../src/db/qdrant";
import { query } from "../src/db/client";

// Mock the database client module
vi.mock("../src/db/client", () => ({
  query: vi.fn(),
}));

// Mock constants to enable dual-store
vi.mock("../src/config/constants", async () => {
  const actual = await vi.importActual("../src/config/constants");
  return {
    ...actual,
    USE_DUAL_VECTOR_STORE: true,
  };
});

describe("Dual Store Health Monitoring", () => {
  let app: any;
  const mockQuery = vi.mocked(query);

  beforeEach(async () => {
    app = Fastify();
    await healthRoutes(app);
    vi.clearAllMocks();
  });

  describe("GET /api/health - Drift Detection", () => {
    it("should report healthy when stores are in sync", async () => {
      // Mock equal counts in both stores
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "100" }] } as any) // chunks count
        .mockResolvedValueOnce({ rows: [{ count: "10" }] } as any); // documents count

      vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({
        points_count: 100,
        vectors_count: 100,
        status: "green",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe("healthy");
      expect(body.postgres.chunks).toBe(100);
      expect(body.qdrant.points).toBe(100);
      expect(body.sync.inSync).toBe(true);
      expect(body.sync.drift).toBe(0);
      expect(body.sync.driftPercentage).toBe("0.00%"); // Actual format from implementation
    });

    it("should detect drift when counts mismatch", async () => {
      // Postgres has 100 chunks, Qdrant has 95
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "100" }] })
        .mockResolvedValueOnce({ rows: [{ count: "10" }] });

      vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({
        points_count: 95,
        vectors_count: 95,
        status: "green",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const body = JSON.parse(response.body);

      expect(body.status).toBe("degraded");
      expect(body.sync.inSync).toBe(false);
      expect(body.sync.drift).toBe(5);
      expect(body.sync.driftPercentage).toBe("5.00%");
      expect(body.warning).toContain("5 chunks out of sync");
    });

    it("should calculate drift percentage correctly", async () => {
      // Postgres: 200, Qdrant: 150 → 25% drift
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "200" }] })
        .mockResolvedValueOnce({ rows: [{ count: "10" }] });

      vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({
        points_count: 150,
        vectors_count: 150,
        status: "green",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const body = JSON.parse(response.body);

      expect(body.sync.drift).toBe(50);
      expect(body.sync.driftPercentage).toBe("25.00%");
    });

    it("should handle Qdrant more points than Postgres", async () => {
      // Qdrant has orphaned data
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "80" }] })
        .mockResolvedValueOnce({ rows: [{ count: "5" }] });

      vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({
        points_count: 100,
        vectors_count: 100,
        status: "green",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const body = JSON.parse(response.body);

      expect(body.status).toBe("degraded");
      expect(body.sync.drift).toBe(20); // |80 - 100| = 20
    });

    it("should report degraded when Qdrant is unreachable", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "100" }] })
        .mockResolvedValueOnce({ rows: [{ count: "10" }] });

      vi.spyOn(qdrant, "getQdrantStats").mockRejectedValue(
        new Error("Connection refused")
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const body = JSON.parse(response.body);

      expect(body.status).toBe("degraded");
      expect(body.qdrant.connected).toBe(false);
      expect(body.qdrant.error).toBe("Connection refused");
      expect(body.warning).toContain("Qdrant connection failed");
    });

    it("should return 500 when Postgres fails", async () => {
      mockQuery.mockRejectedValue(
        new Error("Postgres connection timeout")
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.status).toBe("unhealthy");
      expect(body.error).toBe("Postgres connection timeout");
    });

    it("should handle zero chunks gracefully", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "0" }] })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] });

      vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({
        points_count: 0,
        vectors_count: 0,
        status: "green",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const body = JSON.parse(response.body);

      expect(body.status).toBe("healthy");
      expect(body.sync.inSync).toBe(true);
      expect(body.sync.driftPercentage).toBe("0%"); // Special case when chunks = 0
    });
  });

  describe("POST /api/health/reconcile", () => {
    it("should return reconciliation summary", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: "chunk-1" },
          { id: "chunk-2" },
          { id: "chunk-3" },
        ],
      });

      vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({
        points_count: 3,
        vectors_count: 3,
        status: "green",
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/health/reconcile",
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.postgres.chunks).toBe(3);
      expect(body.qdrant.points).toBe(3);
      expect(body.note).toContain("Full ID-level reconciliation");
    });

    it("should handle reconciliation errors gracefully", async () => {
      mockQuery.mockRejectedValue(
        new Error("Database error")
      );

      const response = await app.inject({
        method: "POST",
        url: "/api/health/reconcile",
      });

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("Reconciliation failed");
    });
  });

  describe("Health Response Structure", () => {
    it("should include all required fields", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "50" }] })
        .mockResolvedValueOnce({ rows: [{ count: "5" }] });

      vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({
        points_count: 50,
        vectors_count: 50,
        status: "green",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const body = JSON.parse(response.body);

      // Required fields
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("timestamp");
      expect(body).toHaveProperty("postgres");
      expect(body).toHaveProperty("qdrant");
      expect(body).toHaveProperty("sync");

      // Postgres details
      expect(body.postgres).toHaveProperty("connected");
      expect(body.postgres).toHaveProperty("documents");
      expect(body.postgres).toHaveProperty("chunks");

      // Qdrant details
      expect(body.qdrant).toHaveProperty("connected");
      expect(body.qdrant).toHaveProperty("status");
      expect(body.qdrant).toHaveProperty("points");

      // Sync details
      expect(body.sync).toHaveProperty("inSync");
      expect(body.sync).toHaveProperty("drift");
      expect(body.sync).toHaveProperty("driftPercentage");
    });

    it("should include timestamp in ISO format", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "10" }] })
        .mockResolvedValueOnce({ rows: [{ count: "1" }] });

      vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({
        points_count: 10,
        vectors_count: 10,
        status: "green",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const body = JSON.parse(response.body);

      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });
  });
});
