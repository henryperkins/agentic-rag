// Layer 10: Observability & Monitoring
import { context, trace, type Attributes } from "@opentelemetry/api";

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

/**
 * Bootstraps OpenTelemetry NodeSDK with HTTP/Fastify/PG auto-instrumentations.
 * Controlled via env:
 *  - ENABLE_OTEL=true
 *  - OTEL_SERVICE_NAME=rag-chat-backend
 *  - OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces (default)
 */
const ENABLE_OTEL = process.env.ENABLE_OTEL === "true";
if (ENABLE_OTEL) {
  const serviceName = process.env.OTEL_SERVICE_NAME || "rag-chat-backend";

  const traceExporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces",
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    }),
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  // Start without awaiting to allow early patching while modules load
  try {
    // Start SDK (non-blocking in current SDK versions)
    sdk.start();
    // eslint-disable-next-line no-console
    console.log(`[otel] NodeSDK started (${serviceName})`);
  } catch (err) {
    console.error("[otel] NodeSDK start failed", err);
  }

  // Graceful shutdown
  const shutdown = () => {
    sdk
      .shutdown()
      .then(() => console.log("[otel] NodeSDK shut down"))
      .catch((err: unknown) => console.error("[otel] NodeSDK shutdown error", err));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

// Tracer utility + helpers
export const tracer = trace.getTracer("rag-chat");

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T> | T,
  attrs?: Record<string, unknown>
): Promise<T> {
  return await tracer.startActiveSpan(name, async (span) => {
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v as any);
    }
    try {
      const res = await fn();
      return res;
    } catch (e: any) {
      span.recordException(e);
      span.setAttribute("error", true);
      throw e;
    } finally {
      span.end();
    }
  });
}

export function addEvent(name: string, attrs?: Record<string, unknown>) {
  const span = trace.getSpan(context.active());
  span?.addEvent(name, attrs as Attributes | undefined);
}