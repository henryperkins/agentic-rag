// Layer 7: Retrieval Services
import {
  HYBRID_KEYWORD_WEIGHT,
  HYBRID_VECTOR_WEIGHT,
  RAG_TOP_K,
  USE_DUAL_VECTOR_STORE
} from "../config/constants";
import { embedText } from "./embeddings";
import {
  vectorSearch,
  trigramTitleSearch,
  chunksByDocumentIds
} from "../db/sql";
import { vectorSearchQdrant, QdrantVectorResult } from "../db/qdrant";
import { rerank, Candidate } from "./reranker";
import { addEvent, withSpan } from "../config/otel";

export interface RetrievedChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  source: string | null;
  score: number;
  rerankerScore?: number; // Preserve reranker's semantic score
  citationStart?: number;
  citationEnd?: number;
}

export type HybridRetrieveResult = RetrievedChunk[] & { queryEmbedding: number[] };

export async function hybridRetrieve(queryText: string, useHybrid = true): Promise<HybridRetrieveResult> {
  addEvent("retrieval.hybrid.start", {
    useHybrid,
    dualStore: USE_DUAL_VECTOR_STORE,
    queryLength: queryText.length
  });

  const qEmb = await withSpan(
    "retrieval.embed",
    () => embedText(queryText),
    { queryLength: queryText.length }
  );

  // Dual-source vector search: Query both Postgres and Qdrant in parallel
  const pgPromise = vectorSearch(qEmb, RAG_TOP_K * 2);
  const qdrantPromise = USE_DUAL_VECTOR_STORE
    ? vectorSearchQdrant(qEmb, RAG_TOP_K * 2)
    : Promise.resolve([] as QdrantVectorResult[]);
  const trigramPromise = useHybrid
    ? trigramTitleSearch(queryText, RAG_TOP_K * 2)
    : Promise.resolve([] as Awaited<ReturnType<typeof trigramTitleSearch>>);

  const [pgResults, qdrantResults, tResults] = await withSpan(
    "retrieval.parallelSearch",
    () =>
      Promise.all([
        pgPromise,
        qdrantPromise,
        trigramPromise
      ]),
    { useHybrid, dualStore: USE_DUAL_VECTOR_STORE }
  );

  addEvent("retrieval.search.completed", {
    postgresHits: pgResults.length,
    qdrantHits: qdrantResults?.length || 0,
    trigramDocs: tResults.length
  });

  const titleDocIds = tResults.map((r) => r.document_id);
  const trigramChunks =
    titleDocIds.length > 0
      ? await withSpan(
        "retrieval.fetchTrigramChunks",
        () => chunksByDocumentIds(titleDocIds, 2),
        { docCount: titleDocIds.length }
      )
      : [];

  addEvent("retrieval.trigram.completed", {
    trigramDocHits: titleDocIds.length,
    trigramChunkHits: trigramChunks.length
  });

  // Map trigram scores to chunks
  const trigramScoreByDoc = Object.fromEntries(
    tResults.map((r) => [r.document_id, r.trigram_sim || 0])
  );

  // Combine scores from both vector sources
  interface PrelimCandidate extends Candidate {
    source: string | null;
  }
  const prelim: PrelimCandidate[] = [];
  const add = (id: string, document_id: string, chunk_index: number, content: string, source: string | null, preScore: number) => {
    prelim.push({ id, document_id, chunk_index, content, source, preScore });
  };

  // Add Postgres vector results
  for (const v of pgResults) {
    add(v.id, v.document_id, v.chunk_index, v.content, v.source, HYBRID_VECTOR_WEIGHT * (v.vector_sim || 0));
  }

  // Add Qdrant vector results (if dual-store enabled)
  if (USE_DUAL_VECTOR_STORE && qdrantResults.length > 0) {
    for (const q of qdrantResults) {
      // Qdrant score is already cosine similarity (0-1 range)
      add(q.chunk_id, q.document_id, q.chunk_index, q.content, q.source, HYBRID_VECTOR_WEIGHT * q.score);
    }
  }

  // Add trigram keyword results
  for (const c of trigramChunks) {
    const tScore = trigramScoreByDoc[c.document_id] || 0;
    add(c.id, c.document_id, c.chunk_index, c.content, c.source, HYBRID_KEYWORD_WEIGHT * tScore);
  }

  // Deduplicate by chunk id (keep max preScore for each unique chunk)
  // This is where dual-store benefits: if same chunk found in both sources, we keep higher score
  const dedupMap = new Map<string, PrelimCandidate>();
  for (const cand of prelim) {
    const prev = dedupMap.get(cand.id);
    if (!prev || cand.preScore > prev.preScore) dedupMap.set(cand.id, cand);
  }

  const cands = Array.from(dedupMap.values());
  addEvent("retrieval.combine.completed", {
    deduplicatedCandidates: cands.length,
    preliminaryCandidates: prelim.length
  });

  const reranked = await withSpan(
    "retrieval.rerank",
    () => rerank(queryText, cands),
    { candidateCount: cands.length }
  );
  const top = reranked.slice(0, RAG_TOP_K);
  addEvent("retrieval.hybrid.ready", {
    finalCount: top.length,
    topScore: top[0]?.preScore ?? null
  });
  // Map results with source from database/Qdrant and preserve reranker score
  const mapped = top.map((c) => ({
    id: c.id,
    document_id: c.document_id,
    chunk_index: c.chunk_index,
    content: c.content,
    source: (c as PrelimCandidate).source,
    score: c.preScore,
    rerankerScore: c.preScore // Preserve for downstream grading integration
  }));

  const result = mapped as HybridRetrieveResult;
  result.queryEmbedding = qEmb;
  return result;
}
