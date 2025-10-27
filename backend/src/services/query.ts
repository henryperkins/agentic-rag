// Layer 2: Query Processing
import { insertRewrite } from "../db/sql";

export function maybeRewriteQuery(original: string): { rewritten: string | null; reason: string } {
  const trimmed = original.trim();
  // Heuristic: If shorter than 6 tokens, expand keywords with generic context
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 6) {
    const rewritten = `${trimmed} (context: RAG chat app, hybrid retrieval, citations)`;
    return { rewritten, reason: "Short/ambiguous query expanded for better recall." };
  }
  return { rewritten: null, reason: "No rewrite needed." };
}

export async function persistRewrite(original: string, rewritten: string | null) {
  if (rewritten && rewritten !== original) {
    await insertRewrite(original, rewritten);
  }
}
