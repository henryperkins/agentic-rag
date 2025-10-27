import { register, Counter, Gauge, Histogram } from "prom-client";

// General Metrics
export const requestCounter = new Counter({
  name: "rag_requests_total",
  help: "Total RAG requests",
  labelNames: ["route", "status_code"],
});

export const requestDurationHistogram = new Histogram({
  name: "rag_request_duration_seconds",
  help: "Request latency",
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

// Dual-Store Metrics
export const dualStoreReconcileRunsCounter = new Counter({
  name: "dual_store_reconcile_runs_total",
  help: "Total number of dual-store reconciliation runs.",
});

export const dualStoreDriftGauge = new Gauge({
  name: "dual_store_drift_chunks",
  help: "Number of chunks out of sync between Postgres and Qdrant.",
});

// Web Search Metrics
export const webSearchRequestsCounter = new Counter({
  name: "web_search_requests_total",
  help: "Total number of web search requests.",
});

export const webSearchErrorsCounter = new Counter({
  name: "web_search_errors_total",
  help: "Total number of web search errors.",
});

export const webSearchCacheHitsCounter = new Counter({
  name: "web_search_cache_hits_total",
  help: "Total number of web search cache hits.",
});

// Rate Limiting Metrics
export const rateLimitEnforcedCounter = new Counter({
  name: "rate_limit_enforced_total",
  help: "Total number of rate limit enforcements.",
  labelNames: ["ip"],
});

export const rateLimitRejectionsCounter = new Counter({
  name: "rate_limit_rejections_total",
  help: "Total number of rate limit rejections.",
  labelNames: ["ip"],
});

// Reranker Metrics
export const rerankerFallbackCounter = new Counter({
  name: "reranker_fallback_total",
  help: "Total number of reranker fallbacks to Jaccard similarity.",
});

// Cache Metrics
export const cacheHitRateGauge = new Gauge({
  name: "cache_hit_rate",
  help: "Cache hit rate.",
  labelNames: ["cache_name"],
});

export const cacheEvictionsCounter = new Counter({
  name: "cache_evictions_total",
  help: "Total number of cache evictions.",
  labelNames: ["cache_name"],
});

// Expose metrics endpoint
export async function getMetrics() {
  return await register.metrics();
}

export function getContentType() {
  return register.contentType;
}