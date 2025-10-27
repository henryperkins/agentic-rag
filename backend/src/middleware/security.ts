// Layer 11: Security & Governance
import { FastifyRequest, FastifyReply } from "fastify";

// Simple in-memory token bucket by IP. Not for prod use—demonstrates L11.
const buckets = new Map<string, { tokens: number; last: number }>();
const CAP = 60; // tokens
const REFILL_RATE_PER_SEC = 1; // refill per second

export async function onRequestRateLimit(req: FastifyRequest, reply: FastifyReply) {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip;
  const now = Date.now() / 1000;
  const b = buckets.get(ip) || { tokens: CAP, last: now };
  const delta = now - b.last;
  b.tokens = Math.min(CAP, b.tokens + delta * REFILL_RATE_PER_SEC);
  b.last = now;
  if (b.tokens < 1) {
    reply.code(429).send({ error: "rate_limited" });
    return;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
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
