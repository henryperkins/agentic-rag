import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcileStores } from "../src/jobs/dualStoreReconciler";
import * as client from "../src/db/client";
import * as qdrant from "../src/db/qdrant";
import * as metrics from "../src/config/metrics";

vi.mock("../src/db/client");
vi.mock("../src/db/qdrant");
vi.mock("../src/config/metrics");

describe("Dual Store Reconciler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect and report drift", async () => {
    const mockQuery = vi.spyOn(client, "query").mockResolvedValue({ rows: [{ count: "100" }] } as any);
    const mockGetQdrantStats = vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({ points_count: 95, vectors_count: 95, status: "green" } as any);
    const mockInc = vi.spyOn(metrics.dualStoreReconcileRunsCounter, "inc");
    const mockSet = vi.spyOn(metrics.dualStoreDriftGauge, "set");

    const result = await reconcileStores();

    expect(mockQuery).toHaveBeenCalledWith("SELECT COUNT(*) as count FROM chunks");
    expect(mockGetQdrantStats).toHaveBeenCalled();
    expect(mockInc).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(5);
    expect(result.drift).toBe(5);
  });

  it("should report no drift when stores are in sync", async () => {
    const mockQuery = vi.spyOn(client, "query").mockResolvedValue({ rows: [{ count: "100" }] } as any);
    const mockGetQdrantStats = vi.spyOn(qdrant, "getQdrantStats").mockResolvedValue({ points_count: 100, vectors_count: 100, status: "green" } as any);
    const mockSet = vi.spyOn(metrics.dualStoreDriftGauge, "set");

    const result = await reconcileStores();

    expect(mockSet).toHaveBeenCalledWith(0);
    expect(result.drift).toBe(0);
  });
});