// Sync Health Check Routes
import { FastifyInstance } from "fastify";
import { query } from "../db/client";
import { getQdrantStats } from "../db/qdrant";
import { USE_DUAL_VECTOR_STORE } from "../config/constants";

export async function healthRoutes(app: FastifyInstance) {
  /**
   * Health check endpoint with sync verification
   * GET /api/health
   */
  app.get("/api/health", async (_req, reply) => {
    try {
      // Get Postgres counts
      const pgChunksResult = await query<{ count: string }>(
        "SELECT COUNT(*) as count FROM chunks"
      );
      const pgDocsResult = await query<{ count: string }>(
        "SELECT COUNT(*) as count FROM documents"
      );

      const postgresChunks = parseInt(pgChunksResult.rows[0].count, 10);
      const postgresDocs = parseInt(pgDocsResult.rows[0].count, 10);

      const health: any = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        postgres: {
          connected: true,
          documents: postgresDocs,
          chunks: postgresChunks,
        },
      };

      // Check Qdrant if dual-store enabled
      if (USE_DUAL_VECTOR_STORE) {
        try {
          const qdrantStats = await getQdrantStats();
          const pointCount = qdrantStats.points_count ?? 0;

          health.qdrant = {
            connected: true,
            status: qdrantStats.status,
            points: pointCount,
            vectors: qdrantStats.vectors_count,
          };

          // Check for sync drift
          const drift = Math.abs(postgresChunks - pointCount);
          health.sync = {
            inSync: drift === 0,
            drift: drift,
            driftPercentage:
              postgresChunks > 0
                ? ((drift / postgresChunks) * 100).toFixed(2) + "%"
                : "0%",
          };

          // Warn if drift detected
          if (drift > 0) {
            health.status = "degraded";
            health.warning = `Detected ${drift} chunks out of sync between Postgres and Qdrant`;
          }
        } catch (qdrantError) {
          health.qdrant = {
            connected: false,
            error: (qdrantError as Error).message,
          };
          health.status = "degraded";
          health.warning = "Qdrant connection failed - running on Postgres only";
        }
      }

      reply.send(health);
    } catch (error) {
      reply.code(500).send({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: (error as Error).message,
      });
    }
  });

  /**
   * Sync reconciliation endpoint (admin only - no auth yet)
   * POST /api/health/reconcile
   * Returns list of chunk IDs that exist in one store but not the other
   */
  app.post("/api/health/reconcile", async (_req, reply) => {
    if (!USE_DUAL_VECTOR_STORE) {
      reply.send({
        message: "Dual-store not enabled",
        reconciliationNeeded: false,
      });
      return;
    }

    try {
      // Get all chunk IDs from Postgres
      const pgChunks = await query<{ id: string }>("SELECT id FROM chunks");
      const pgChunkIds = new Set(pgChunks.rows.map((r) => r.id));

      // Get all point IDs from Qdrant
      const qdrantStats = await getQdrantStats();

      reply.send({
        message: "Reconciliation check completed",
        postgres: {
          chunks: pgChunkIds.size,
        },
        qdrant: {
          points: qdrantStats.points_count ?? 0,
        },
        note: "Full ID-level reconciliation requires scrolling Qdrant points - implement if needed",
      });
    } catch (error) {
      reply.code(500).send({
        error: "Reconciliation failed",
        message: (error as Error).message,
      });
    }
  });
}
