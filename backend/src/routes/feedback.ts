// Layer 14: Feedback & Evaluation
import { FastifyInstance } from "fastify";
import { query } from "../db/client";

export async function feedbackRoutes(app: FastifyInstance) {
  app.post("/api/feedback", async (req, reply) => {
    const body = (await req.body) as { rating: "up" | "down"; comment?: string; traceId?: string; question?: string };
    await query(
      "INSERT INTO feedback (rating, comment, trace_id, question) VALUES ($1, $2, $3, $4)",
      [body.rating, body.comment || null, body.traceId || null, body.question || null]
    );
    reply.send({ ok: true });
  });
}
