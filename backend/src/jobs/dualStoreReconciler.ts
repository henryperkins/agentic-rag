import { query } from "../db/client";
import { getQdrantStats } from "../db/qdrant";
import { withSpan } from "../config/otel";
import { dualStoreReconcileRunsCounter, dualStoreDriftGauge } from "../config/metrics";

export async function reconcileStores() {
  return await withSpan("job.reconcileStores", async () => {
    dualStoreReconcileRunsCounter.inc();
    console.log("Running dual-store reconciliation job...");

    try {
      const pgResult = await query<{ count: string }>("SELECT COUNT(*) as count FROM chunks");
      const pgCount = parseInt(pgResult.rows[0].count, 10);

      const qdrantStats = await getQdrantStats();
      const qdrantCount = qdrantStats.points_count ?? 0;

      const drift = Math.abs(pgCount - qdrantCount);
      dualStoreDriftGauge.set(drift);

      if (drift > 0) {
        console.warn(`Dual-store drift detected: ${drift} chunks`);
      } else {
        console.log("Dual-stores are in sync.");
      }

      return {
        postgresChunks: pgCount,
        qdrantPoints: qdrantCount,
        drift,
      };
    } catch (error) {
      console.error("Failed to run reconciliation job:", error);
      throw error;
    }
  });
}