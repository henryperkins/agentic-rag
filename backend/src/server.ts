// Layer 1: Backend Server Entry Point
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./config/env";
import { chatRoutes } from "./routes/chat";
import { documentRoutes } from "./routes/documents";
import { feedbackRoutes } from "./routes/feedback";
import { healthRoutes } from "./routes/health";
import { onRequestRateLimit, preHandlerAuth } from "./middleware/security";
import { initQdrantCollection } from "./db/qdrant";
import { USE_DUAL_VECTOR_STORE, QDRANT_URL, QDRANT_API_KEY } from "./config/constants";

/**
 * Validate Qdrant Cloud configuration at startup
 * Prevents runtime failures due to missing credentials
 */
function validateQdrantConfig() {
  if (!USE_DUAL_VECTOR_STORE) {
    return; // Dual-store disabled, skip validation
  }

  const isCloudUrl = QDRANT_URL.includes("cloud.qdrant.io");

  if (isCloudUrl && !QDRANT_API_KEY) {
    console.error(
      "❌ FATAL: Qdrant Cloud URL detected but QDRANT_API_KEY is missing!\n" +
      `   URL: ${QDRANT_URL}\n` +
      "   Fix: Set QDRANT_API_KEY in your .env file\n" +
      "   Example: QDRANT_API_KEY=your-api-key-here"
    );
    process.exit(1);
  }

  if (isCloudUrl) {
    console.log(`✓ Qdrant Cloud configuration validated: ${QDRANT_URL}`);
  } else {
    console.log(`✓ Qdrant local/self-hosted configuration: ${QDRANT_URL}`);
  }
}

async function build() {
  const app = Fastify({ logger: true });

  // Validate Qdrant configuration before initialization
  validateQdrantConfig();

  // Initialize Qdrant collection if dual-store is enabled
  if (USE_DUAL_VECTOR_STORE) {
    app.log.info("Dual vector store enabled, initializing Qdrant...");
    await initQdrantCollection();
  }

  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(multipart);

  // Health check routes (no auth required)
  await healthRoutes(app);

  // Cross-cutting guards (L11) + simple rate-limit (L1/L11).
  app.addHook("onRequest", onRequestRateLimit);
  app.addHook("preHandler", preHandlerAuth);

  await chatRoutes(app);
  await documentRoutes(app);
  await feedbackRoutes(app);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`Backend listening on http://localhost:${env.PORT}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
