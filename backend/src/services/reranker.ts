// Layer 7: Retrieval - Reranking
import { RERANKER_MODEL } from "../config/constants";
import { withSpan, addEvent } from "../config/otel";
import { rerankerFallbackCounter } from "../config/metrics";

export interface Candidate {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  preScore: number; // combined hybrid score
}

function tokenize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function jaccard(a: Set<string>, b: Set<string>) {
  const inter = new Set([...a].filter((x) => b.has(x))).size;
  const union = new Set([...a, ...b]).size || 1;
  return inter / union;
}

export async function rerank(
  query: string,
  candidates: Candidate[]
): Promise<Candidate[]> {
  return await withSpan("rerank", async () => {
    // Try to use @dqbd/qdrant (best-effort)
    try {
      const lib: any = await import("@dqbd/qdrant").catch(() => null);
      if (lib && typeof lib.rerank === "function") {
        const scores = await lib.rerank(RERANKER_MODEL, query, candidates.map((c) => c.content));
        addEvent("reranker.model", { model: RERANKER_MODEL });
        // Map scores (assume higher better)
        return candidates
          .map((c, i) => ({ ...c, preScore: Number(scores[i] ?? c.preScore) }))
          .sort((a, b) => b.preScore - a.preScore);
      }
    } catch (error) {
      // ignore and fallback
      addEvent("reranker.error", { message: (error as Error).message });
    }

    // Fallback: 0.7 * word-overlap (Jaccard) + 0.3 * preScore
    rerankerFallbackCounter.inc();
    addEvent("reranker.fallback", { fallback: true });
    console.warn("Reranker failed, falling back to Jaccard similarity");
    const qSet = new Set(tokenize(query));
    const rescored = candidates.map((c) => {
      const cSet = new Set(tokenize(c.content));
      const overlap = jaccard(qSet, cSet);
      const score = 0.7 * overlap + 0.3 * (c.preScore || 0);
      return { ...c, preScore: score };
    });
    return rescored.sort((a, b) => b.preScore - a.preScore);
  });
}
