// Layer 1: Chat Route with SSE
import { FastifyInstance } from "fastify";
import { SSEOutEvent, ChatRequestBody } from "../../../shared/types";
import { runCoordinator } from "../services/orchestration/coordinator";
import { ENABLE_WEB_SEARCH } from "../config/constants";

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

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const sender = (e: SSEOutEvent) => sseWrite(reply, e);

    try {
      await runCoordinator(message, sender, { useRag, useHybrid, useWeb });
    } catch (err: any) {
      sseWrite(reply, { type: "tokens", text: `Error: ${err?.message || "unknown"}`, ts: Date.now() });
      sseWrite(reply, { type: "final", text: "An error occurred while processing your request.", citations: [], verified: false, ts: Date.now() });
    } finally {
      reply.raw.end();
    }

    return reply;
  });
}
