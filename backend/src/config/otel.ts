// Layer 10: Observability & Monitoring
import { context, trace, type Attributes } from "@opentelemetry/api";

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
      span.end();
      return res;
    } catch (e: any) {
      span.recordException(e);
      span.setAttribute("error", true);
      span.end();
      throw e;
    }
  });
}

export function addEvent(name: string, attrs?: Record<string, unknown>) {
  const span = trace.getSpan(context.active());
  span?.addEvent(name, attrs as Attributes | undefined);
}
