// Layer 1: Chat Route with SSE
import { FastifyInstance } from "fastify";
import { SSEOutEvent, ChatRequestBody } from "../../../shared/types";
import { runCoordinator } from "../services/orchestration/coordinator";
import { ENABLE_WEB_SEARCH } from "../config/constants";
import { addEvent } from "../config/otel";
import { trace } from "@opentelemetry/api";

function sseWrite(reply: any, event: SSEOutEvent) {
  reply.raw.write(`event: ${event.type}\n`);
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function chatRoutes(app: FastifyInstance) {
  app.post("/api/chat", { logLevel: "info" }, async (req, reply) => {
    const body = (await req.body) as ChatRequestBody;
    const message = body?.message?.toString() || "";
    const useRag = body?.useRag !== false;
    const useHybrid = body?.useHybrid !== false;
    const useWeb = ENABLE_WEB_SEARCH ? body?.useWeb !== false : false;
    const allowedDomains = body?.allowedDomains;

    const span = trace.getActiveSpan();
    span?.setAttributes({ useRag, useHybrid, useWeb, allowedDomains: allowedDomains?.join(",") });
    addEvent("chat.request", { message });

    // SSE connection setup: detect client disconnect and keep-alive pings
    let aborted = false;
    const onClose = () => {
      aborted = true;
      try { reply.raw.end(); } catch {}
    };
    (req.raw as any).on?.("close", onClose);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    // Flush headers to start streaming immediately
    reply.raw.flushHeaders?.();
    // Recommended: reconnection delay for native EventSource clients
    reply.raw.write(`retry: 15000\n\n`);
    // Keep-alive ping to keep proxies from buffering
    const keepAlive = setInterval(() => {
      if (aborted) return;
      try {
        reply.raw.write(`event: ping\n`);
        reply.raw.write(`data: {}\n\n`);
      } catch {}
    }, 15000);

    const sender = (e: SSEOutEvent) => {
      if (aborted) return;
      sseWrite(reply, e);
    };

    // Heartbeat to close zombie connections
    const heartbeat = setInterval(() => {
      if (reply.raw.socket?.destroyed) {
        clearInterval(heartbeat);
        clearInterval(keepAlive);
        aborted = true;
      }
    }, 30000);

    try {
      await runCoordinator(message, sender, { useRag, useHybrid, useWeb, allowedDomains });
    } catch (err: any) {
      if (!aborted) {
        sseWrite(reply, { type: "tokens", text: `Error: ${err?.message || "unknown"}`, ts: Date.now() });
        sseWrite(reply, { type: "final", text: "An error occurred while processing your request.", citations: [], verified: false, ts: Date.now() });
      }
    } finally {
      clearInterval(keepAlive);
      clearInterval(heartbeat);
      if (!aborted) {
        try { reply.raw.end(); } catch {}
      }
    }

    return reply;
  });
}
