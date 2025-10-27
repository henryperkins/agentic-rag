// Layer 11: Security & Governance
import { FastifyRequest, FastifyReply } from "fastify";
import { query, withTx } from "../db/client";
import { rateLimitEnforcedCounter, rateLimitRejectionsCounter } from "../config/metrics";

const CAP = 60; // tokens
const REFILL_RATE_PER_SEC = 1; // refill per second

export async function onRequestRateLimit(req: FastifyRequest, reply: FastifyReply) {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip;

  await withTx(async (client) => {
    const { rows } = await client.query(
      "SELECT tokens, last_refill FROM rate_limits WHERE ip_address = $1 FOR UPDATE",
      [ip]
    );

    const now = new Date();
    let tokens = CAP;
    let lastRefill = now;

    if (rows.length > 0) {
      const row = rows[0] as any;
      const delta = (now.getTime() - new Date(row.last_refill).getTime()) / 1000;
      tokens = Math.min(CAP, Number(row.tokens) + delta * REFILL_RATE_PER_SEC);
      lastRefill = now;
    }

    if (tokens < 1) {
      rateLimitRejectionsCounter.inc({ ip });
      reply.code(429).send({ error: "rate_limited" });
      return;
    }

    tokens -= 1;
    rateLimitEnforcedCounter.inc({ ip });

    await client.query(
      `
      INSERT INTO rate_limits (ip_address, tokens, last_refill)
      VALUES ($1, $2, $3)
      ON CONFLICT (ip_address)
      DO UPDATE SET tokens = $2, last_refill = $3
      `,
      [ip, tokens, lastRefill]
    );
  });
}

// Very light "auth" stub to mirror OIDC/JWT gate; accepts Bearer but doesn't verify in MOCK.
export async function preHandlerAuth(req: FastifyRequest, _reply: FastifyReply) {
  const auth = req.headers.authorization || "";
  if (process.env.MOCK_OPENAI === "1") return; // allow in tests/offline
  if (!auth.startsWith("Bearer ")) {
    // For demo, allow anonymous but tag the request.
    (req as any).user = { sub: "anonymous", roles: ["viewer"] };
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  // In a real setup you'd verify with JWKS. Here we just pass through.
  (req as any).user = { sub: "bearer", roles: ["viewer"], token: token ? "present" : "missing" };
}

// Example "policy check" for tool-level RBAC/ABAC.
// Return true to allow; integrate OPA/Cerbos in real deployments.
export function policyCheck(_subject: any, _action: string, _resource: string): boolean {
  return true;
}